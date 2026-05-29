import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { moduleArtifacts } from "./module-artifacts.js";

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

/** app://modules/<id>/<version>/<rest...> → 该模块产物目录下的对应文件。app ready 后调。 */
export function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "modules") return new Response("not found", { status: 404 });
    const [id, version, ...rest] = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (!id || !version || rest.length === 0) return new Response("bad path", { status: 400 });
    const dir = moduleArtifacts.dir(id, version);
    if (!dir) return new Response("unknown module artifact", { status: 404 });
    const filePath = normalize(join(dir, ...rest));
    if (!filePath.startsWith(dir)) return new Response("forbidden", { status: 403 }); // 防目录穿越

    const res = await net.fetch(pathToFileURL(filePath).toString());
    // 渲染页在 dev 下源是 http://localhost,import('app://...') 属跨源:补 CORS;
    // 并确保 .js/.mjs 以 JS MIME 返回,才能被当作 ES module 动态 import。
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    if (/\.m?js$/.test(filePath)) headers.set("Content-Type", "text/javascript");
    return new Response(res.body, { status: res.status, headers });
  });
}
