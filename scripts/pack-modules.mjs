// 发布工具链:把各模块 dev 产物收成"地址化 + 校验"的 CDN 载荷(供 RemoteSource 消费)。
// 流程:先跑 build:mods 出产物 → 逐模块读 manifest、定位产物、算 sha256、
// 改写 entry 为 <base>/<id>@<version>.mjs、复制产物 → 汇成单一 catalog.json。
//
// staging/prod 的唯一区别是地址。base 取自 module-envs.json 里该 env 的条目 ——
// 与客户端 env.ts 同一份事实源(客户端从 <base>/catalog.json 拉,发布往 <base> 写),
// 不在发布侧另写一份地址表。用法:pack:mods <staging|prod>。
// catalog 版本号用与 host/sources.ts 一致的 manifestsHash(sorted id+version 的 sha256),
// 内容寻址、确定性,驱动客户端轮询对账。
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url))); // 仓库根(scripts/ 的上级)
const modulesRoot = join(repo, "modules");

// 地址表在仓库根,与客户端 env.ts 同一份单一事实源(发布写、客户端拉,共用)。
const bases = JSON.parse(await readFile(join(repo, "module-envs.json"), "utf8"));
const env = process.argv[2];
if (!env || !(env in bases)) {
  console.error(`用法:pnpm pack:mods <${Object.keys(bases).join(" | ")}>`);
  console.error(`地址取自 module-envs.json;当前 env "${env ?? ""}" 无对应条目。`);
  process.exit(1);
}
const baseUrl = bases[env].replace(/\/+$/, ""); // 去尾斜杠
const publishDir = join(repo, "out", "publish", env); // workspace 级发布产物(非 shell),按 env 分目录互不覆盖

function sha256(data) {
  return "sha256-" + createHash("sha256").update(data).digest("hex");
}

// 与 host/sources.ts 的 manifestsHash 同算法:catalog 版本号 = sorted(id+version) 的 sha256。
function manifestsHash(modules) {
  const stable = [...modules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, version: m.version }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

async function discoverModules() {
  const entries = await readdir(modulesRoot, { withFileTypes: true }).catch(() => []);
  const mods = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(modulesRoot, e.name);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    mods.push(dir);
  }
  return mods;
}

// 先出 dev 产物,发布从产物收口(单命令完成打包 + 发布)。
await import("./build-modules.mjs");

await mkdir(publishDir, { recursive: true });
const published = [];
for (const dir of await discoverModules()) {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const artifactPath = isAbsolute(manifest.entry) ? manifest.entry : resolve(dir, manifest.entry);
  if (!existsSync(artifactPath)) {
    throw new Error(`模块 ${manifest.id} 产物缺失:${artifactPath}(先 build:mods)`);
  }
  const data = await readFile(artifactPath);
  const fileName = `${manifest.id}@${manifest.version}.mjs`;
  await copyFile(artifactPath, join(publishDir, fileName));
  // 保留人写元信息(id/version/runtime/hostApiVersion/ui),派生 entry(地址)+ integrity。
  published.push({ ...manifest, entry: `${baseUrl}/${fileName}`, integrity: sha256(data) });
}

const catalog = { version: manifestsHash(published), modules: published };
await writeFile(join(publishDir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");

console.log(`[pack:mods] env=${env}  发布 ${published.length} 个模块 → ${publishDir}`);
console.log(`[pack:mods] catalog.json  version=${catalog.version.slice(0, 12)}…  base=${baseUrl}`);
for (const m of published) {
  console.log(`  - ${m.id}@${m.version}  ${m.integrity.slice(0, 20)}…  ${m.entry}`);
}
