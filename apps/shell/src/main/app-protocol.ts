import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol } from "electron";

/** 模块产物本地缓存目录。Increment B:renderer 模块下载校验后落这里,再由渲染层 import('app://...')。 */
export const MODULE_CACHE_DIR = join(app.getPath("userData"), "modules-cache");

/** 在 app ready 前把 app:// 注册成特权 scheme(standard + secure + 支持 fetch/stream),
 *  使渲染层可 import('app://...') 且不撞 https 远程的 CSP 限制。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** app://modules/<id>/<version>/<path> → 本地缓存文件。app ready 后调。 */
export function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const filePath = join(MODULE_CACHE_DIR, rel);
    if (!filePath.startsWith(MODULE_CACHE_DIR)) {
      return new Response("forbidden", { status: 403 }); // 防目录穿越
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
