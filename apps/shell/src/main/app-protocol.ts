import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { type Session, net, protocol } from "electron";
import { moduleArtifacts } from "./module-artifacts.js";

// 共享依赖(react / react-dom)产物目录,经 app://vendor/<file> 提供给渲染页 import map。
let vendorDir: string | null = null;
export function setVendorDir(dir: string): void {
  vendorDir = dir;
}

/** 在 app ready 前把 app:// 注册成特权 scheme(standard + secure + 支持 fetch/stream),
 *  使渲染层可 import('app://...') 且不撞 https 远程的 CSP 限制。
 *  corsEnabled 必须置位:dev 下渲染源是 http://localhost,import('app://...') 属跨源——
 *  Electron 42 / 新 Chromium 起,非内置 scheme 必须声明 corsEnabled 才纳入 CORS 流程,
 *  否则在 handler 被调用前就以「Cross origin requests are only supported for ...」直接拦掉
 *  (handler 里补的 Access-Control-Allow-Origin 根本没机会生效)。Electron 38 旧 Chromium 不需要。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

async function handleApp(request: GlobalRequest): Promise<GlobalResponse> {
  const url = new URL(request.url);
  const segs = decodeURIComponent(url.pathname).split("/").filter(Boolean);

  let dir: string | undefined;
  let rest: string[];
  if (url.hostname === "vendor") {
    // app://vendor/<file> → 共享依赖产物目录
    dir = vendorDir ?? undefined;
    rest = segs;
  } else if (url.hostname === "modules") {
    // app://modules/<id>/<version>/<file...> → 该模块产物目录
    const [id, version, ...tail] = segs;
    if (!id || !version) return new Response("bad path", { status: 400 });
    dir = moduleArtifacts.dir(id, version);
    rest = tail;
  } else {
    return new Response("not found", { status: 404 });
  }
  if (!dir) return new Response("unknown artifact root", { status: 404 });
  if (rest.length === 0) return new Response("bad path", { status: 400 });
  const filePath = normalize(join(dir, ...rest));
  if (!filePath.startsWith(dir)) return new Response("forbidden", { status: 403 }); // 防目录穿越

  const res = await net.fetch(pathToFileURL(filePath).toString());
  // 渲染页在 dev 下源是 http://localhost,import('app://...') 属跨源:补 CORS;
  // 并确保 .js/.mjs 以 JS MIME 返回,才能被当作 ES module 动态 import。
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  if (/\.m?js$/.test(filePath)) headers.set("Content-Type", "text/javascript");
  return new Response(res.body, { status: res.status, headers });
}

/** app://modules/<id>/<version>/<rest...> → 该模块产物目录下的对应文件。app ready 后调,
 *  注册到默认 session。 */
export function registerAppProtocol(): void {
  protocol.handle("app", handleApp);
}

/** 给非默认 session(模块内容视图的 partition,如 persist:browser)注册 app:// 处理器:
 *  protocol.handle 只作用于默认 session,partition 各自的 protocol 需单独注册,否则该
 *  partition 里的页面 import('app://...') / 载入 app:// 资产会失败。 */
export function registerAppProtocolForSession(ses: Session): void {
  ses.protocol.handle("app", handleApp);
}
