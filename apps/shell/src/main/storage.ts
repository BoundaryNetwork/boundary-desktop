import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StorageBackend } from "@boundary-desktop/host";

/** 落盘的 StorageBackend:单一 JSON 文件存全部模块的 key(NamespacedStorage 已按 module id 前缀
 *  隔离,这里只管扁平 map 的读写)。默认的内存后端进程重启即丢,模块的 ctx.storage 因此不持久;
 *  本实现让 ctx.storage 真正跨重启留存(账号、偏好等)。延迟读盘:首次访问才载入(此时 app 已就绪)。 */
export class DiskStorageBackend implements StorageBackend {
  #file: string;
  #map: Record<string, unknown> | null = null;

  constructor(file: string) {
    this.#file = file;
  }

  #load(): Record<string, unknown> {
    if (this.#map) return this.#map;
    try {
      this.#map = JSON.parse(readFileSync(this.#file, "utf8")) as Record<string, unknown>;
    } catch {
      this.#map = {}; // 文件不存在/损坏 → 空起步
    }
    return this.#map;
  }

  #flush(): void {
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      writeFileSync(this.#file, JSON.stringify(this.#load()));
    } catch (err) {
      console.error("[storage] 落盘失败", err);
    }
  }

  async get(key: string): Promise<unknown> {
    const m = this.#load();
    return key in m ? m[key] : null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.#load()[key] = value;
    this.#flush();
  }
  async delete(key: string): Promise<void> {
    delete this.#load()[key];
    this.#flush();
  }
  async keys(): Promise<string[]> {
    return Object.keys(this.#load());
  }
}
