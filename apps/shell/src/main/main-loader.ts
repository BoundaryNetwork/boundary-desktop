import type { Module, ModuleLoader, ModuleManifest } from "@boundary-desktop/contract";
import { MainLoader } from "@boundary-desktop/host";
import { moduleArtifacts } from "./module-artifacts.js";

/** 壳侧 main 加载器:在 host 通用 MainLoader 之上,把模块产物目录登记到 app://。
 *  main 模块也能自带 renderer 资产(如浏览器模块的 chrome 页),经 app://modules/<id>/<version>/...
 *  载入 —— 故登记不再是 renderer 模块专属(原先只在 RendererLoader)。app:// 是壳的协议,
 *  登记归壳、不进 host。 */
export class ShellMainLoader implements ModuleLoader {
  #inner = new MainLoader();

  canLoad(manifest: ModuleManifest): boolean {
    return this.#inner.canLoad(manifest);
  }

  load(localPath: string, manifest: ModuleManifest): Promise<Module> {
    moduleArtifacts.register(manifest.id, manifest.version, localPath);
    return this.#inner.load(localPath, manifest);
  }
}
