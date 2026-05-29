import { basename } from "node:path";
import type { Module, ModuleLoader, ModuleManifest } from "@boundary-desktop/contract";
import { moduleArtifacts } from "./module-artifacts.js";
import type { RendererBridge } from "./renderer-bridge.js";

/** renderer 模块的真实例活在渲染进程。本 Loader 在主进程返回一个**代理 Module**:
 *  其 activate/deactivate 经 RendererBridge 让渲染进程 import('app://...') 并跑真模块。
 *  activate 时分配 aid 并把 main 侧 ctx 绑到 bridge——renderer 回调 registerTool 等能力时,
 *  主进程据 aid 找到这同一个 ctx 来执行(于是 track 自动回收、命名空间前缀全照常生效)。 */
export class RendererLoader implements ModuleLoader {
  #bridge: RendererBridge;

  constructor(bridge: RendererBridge) {
    this.#bridge = bridge;
  }

  canLoad(manifest: ModuleManifest): boolean {
    return manifest.runtime === "renderer";
  }

  async load(localPath: string, manifest: ModuleManifest): Promise<Module> {
    moduleArtifacts.register(manifest.id, manifest.version, localPath);
    const url = `app://modules/${manifest.id}/${manifest.version}/${basename(localPath)}`;
    const bridge = this.#bridge;
    let aid = -1;

    return {
      activate: async (ctx) => {
        aid = bridge.nextAid();
        bridge.bindCtx(aid, ctx);
        try {
          await bridge.activate({ aid, id: manifest.id, version: manifest.version, url });
        } catch (err) {
          bridge.releaseCtx(aid);
          throw err; // 让 Registry 走激活失败回滚
        }
      },
      deactivate: async () => {
        try {
          await bridge.deactivate(aid);
        } finally {
          bridge.releaseCtx(aid);
        }
      },
    };
  }
}
