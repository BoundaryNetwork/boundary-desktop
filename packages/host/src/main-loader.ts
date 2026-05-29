import { pathToFileURL } from "node:url";
import type { Module, ModuleLoader, ModuleManifest } from "@boundary-desktop/contract";

/** 主进程模块加载器：产物落本地后，Node 直接 import 本地文件，取 default 导出为 Module 实例。
 *  main 模块拥有完整 Node 能力（信任边界见 spec 第 13 节）。 */
export class MainLoader implements ModuleLoader {
  canLoad(manifest: ModuleManifest): boolean {
    return manifest.runtime === "main";
  }

  async load(localPath: string, manifest: ModuleManifest): Promise<Module> {
    const url = pathToFileURL(localPath).href;
    const imported = (await import(url)) as { default?: unknown };
    const candidate = imported.default;
    if (!candidate || typeof (candidate as Module).activate !== "function") {
      throw new Error(`模块 ${manifest.id} 的产物缺少合法的 default 导出（需含 activate 方法）`);
    }
    return candidate as Module;
  }
}
