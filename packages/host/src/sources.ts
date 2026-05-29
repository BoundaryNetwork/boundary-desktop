import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleManifest } from "@boundary-desktop/contract";
import type { ArtifactSource } from "./registry.js";

/** 单一在线清单文件：列出全部模块的 manifest + 一个 catalog 版本号。
 *  线上不是每模块一个 manifest URL，所有注册都从这一个 catalog 来（见 spec 6.1）。 */
export interface Catalog {
  version: string;
  modules: ModuleManifest[];
}

/** 完整模块来源：发现（catalog）+ 取产物（fetchArtifact）。
 *  Registry 只用到 fetchArtifact（ArtifactSource）；catalog 给对账引擎用。 */
export interface ModuleSource extends ArtifactSource {
  catalog(): Promise<Catalog>;
}

/** 校验产物完整性。integrity 形如 `sha256-<hex>`；不匹配抛错。 */
export function verifyIntegrity(data: Uint8Array, integrity: string): void {
  const sep = integrity.indexOf("-");
  if (sep < 0) throw new Error(`integrity 格式非法：${integrity}（应为 <algo>-<hex>）`);
  const algo = integrity.slice(0, sep);
  const expected = integrity.slice(sep + 1);
  const actual = createHash(algo).update(data).digest("hex");
  if (actual !== expected) {
    throw new Error(`产物完整性校验失败：期望 ${algo}-${expected}，实得 ${algo}-${actual}`);
  }
}

function manifestsHash(modules: ModuleManifest[]): string {
  const stable = [...modules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, version: m.version }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// ===========================================================================
// 本地目录来源（开发）：扫描配置目录，每个子目录一个模块（manifest.json + 产物）。
// 无 CDN，跳过 integrity；entry 相对各模块目录解析。
// ===========================================================================

export class LocalDirSource implements ModuleSource {
  #roots: string[];
  #dirOf = new Map<string, string>();

  constructor(roots: string[]) {
    this.#roots = roots;
  }

  async catalog(): Promise<Catalog> {
    const modules: ModuleManifest[] = [];
    this.#dirOf.clear();
    for (const root of this.#roots) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
      if (!entries) continue; // 目录不存在则跳过
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(root, entry.name);
        let raw: string;
        try {
          raw = await readFile(join(dir, "manifest.json"), "utf8");
        } catch {
          continue; // 无 manifest.json 的目录不算模块
        }
        const manifest = JSON.parse(raw) as ModuleManifest;
        this.#dirOf.set(manifest.id, dir);
        modules.push(manifest);
      }
    }
    return { version: manifestsHash(modules), modules };
  }

  async fetchArtifact(manifest: ModuleManifest): Promise<string> {
    const dir = this.#dirOf.get(manifest.id);
    if (!dir) throw new Error(`本地来源未发现模块 ${manifest.id}（先 catalog()）`);
    return isAbsolute(manifest.entry) ? manifest.entry : resolve(dir, manifest.entry);
  }
}

// ===========================================================================
// 远程 CDN 来源（生产）：拉签名 catalog，下载产物 + 校验 integrity + 落本地缓存。
// ===========================================================================

export interface RemoteSourceOptions {
  catalogUrl: string;
  cacheDir: string;
  /** 可注入 fetch，便于测试/替换传输。默认全局 fetch。 */
  fetch?: typeof fetch;
  /** catalog 签名校验钩子。release build 必须提供；不提供则不验（dev）。
   *  签名方案由环境决定，框架只留 seam（见 spec 6.5）。 */
  verifyCatalog?: (raw: string) => void | Promise<void>;
}

export class RemoteSource implements ModuleSource {
  #catalogUrl: string;
  #cacheDir: string;
  #fetch: typeof fetch;
  #verifyCatalog?: (raw: string) => void | Promise<void>;

  constructor(opts: RemoteSourceOptions) {
    this.#catalogUrl = opts.catalogUrl;
    this.#cacheDir = opts.cacheDir;
    this.#fetch = opts.fetch ?? fetch;
    this.#verifyCatalog = opts.verifyCatalog;
  }

  async catalog(): Promise<Catalog> {
    const res = await this.#fetch(this.#catalogUrl);
    if (!res.ok) throw new Error(`拉取 catalog 失败：HTTP ${res.status}`);
    const raw = await res.text();
    if (this.#verifyCatalog) await this.#verifyCatalog(raw);
    return JSON.parse(raw) as Catalog;
  }

  async fetchArtifact(manifest: ModuleManifest): Promise<string> {
    const res = await this.#fetch(manifest.entry);
    if (!res.ok) throw new Error(`下载模块 ${manifest.id} 产物失败：HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    verifyIntegrity(data, manifest.integrity);
    await mkdir(this.#cacheDir, { recursive: true });
    const dest = join(this.#cacheDir, `${manifest.id}@${manifest.version}.mjs`);
    const tmp = `${dest}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, dest); // 原子落盘，避免返回半截文件
    return dest;
  }
}

/** entry 是 file:// URL 时转本地路径的小工具（local 来源若用 file URL 可调）。 */
export function entryToLocalPath(entry: string): string {
  return entry.startsWith("file:") ? fileURLToPath(entry) : entry;
}
