import { dirname } from "node:path";

/** id@version → 模块产物本地目录,供 app:// handler 解析 import 路径。
 *  RendererLoader 在 load 时登记(fetchArtifact 拿到的本地 entry 路径所在目录)。
 *  对 LocalDirSource 即 modules/<id>,对 RemoteSource 即下载缓存目录,上层无差别。 */
class ModuleArtifacts {
  #dirs = new Map<string, string>();
  #key(id: string, version: string): string {
    return `${id}@${version}`;
  }
  register(id: string, version: string, entryPath: string): void {
    this.#dirs.set(this.#key(id, version), dirname(entryPath));
  }
  dir(id: string, version: string): string | undefined {
    return this.#dirs.get(this.#key(id, version));
  }
}

export const moduleArtifacts = new ModuleArtifacts();
