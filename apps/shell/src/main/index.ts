import { join } from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { HostServices, MainLoader, Registry, startWsFacade } from "@boundary-desktop/host";
import type { BaseContext } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import type { ModuleEntry, SharedState } from "../shared/types.js";
import { ShellAuthDriver } from "./auth.js";
import { registerAppProtocol, registerAppScheme, setVendorDir } from "./app-protocol.js";
import { createModuleSource } from "./env.js";
import { RendererBridge } from "./renderer-bridge.js";
import { RendererLoader } from "./renderer-loader.js";

registerAppScheme(); // 必须在 app ready 前

const authDriver = new ShellAuthDriver();
const host = new HostServices({ auth: authDriver });
const bridge = new RendererBridge();

// 按 active env(local/staging/prod)构造模块来源:local 扫本地、远程拉对应 catalog
const { env: activeEnv, source } = createModuleSource();
console.log(`[shell] 环境:${activeEnv}`);

// 共享依赖(react/react-dom)产物目录,经 app://vendor 提供给渲染页 import map
setVendorDir(process.env.BOUNDARY_VENDOR_DIR ?? join(process.cwd(), "vendor"));

const registry = new Registry({
  source,
  loaders: [new RendererLoader(bridge), new MainLoader()],
  capabilityHost: host,
});

function shared(): SharedState {
  return {
    auth: host.getAuthState(),
    token: host.getToken(),
    config: host.getConfig(),
    network: host.getNetwork(),
  };
}

function requireCtx(aid: number): BaseContext {
  const ctx = bridge.ctx(aid);
  if (!ctx) throw new Error(`无效的 activation id ${aid}(模块未在激活态)`);
  return ctx;
}

// 每个模块 id 一条串行链,防 activate/deactivate 并发交错。
const idChains = new Map<string, Promise<unknown>>();
function serializePerId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = idChains.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  idChains.set(
    id,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

/** 把模块带到至少 loaded(可激活)态:active/loaded 直接返回,inactive 先卸载,
 *  其余从 catalog 取 manifest 安装。 */
async function ensureInstalled(id: string): Promise<void> {
  const st = registry.status(id);
  if (st === "active" || st === "loaded") return;
  if (st === "inactive") await registry.uninstall(id); // 无 inactive→active 转移,重装
  const manifest = (await source.catalog()).modules.find((m) => m.id === id);
  if (!manifest) throw new Error(`catalog 无模块 ${id}`);
  await registry.install(manifest);
}

function registerIpc(): void {
  ipcMain.handle(IPC.appEnv, () => activeEnv);

  // 壳 → main:登录
  ipcMain.handle(IPC.authGetState, () => host.getAuthState());
  ipcMain.handle(IPC.authRequestLogin, () => host.requestLogin());
  ipcMain.handle(IPC.authSubmitLogin, (_e, phone: string, password: string) =>
    authDriver.submit(phone, password),
  );
  ipcMain.handle(IPC.authRequestLogout, () => host.requestLogout());

  // 壳 → main:模块导航与激活
  ipcMain.handle(IPC.modulesList, async (): Promise<ModuleEntry[]> => {
    const catalog = await source.catalog();
    return catalog.modules.map((m) => ({ id: m.id, version: m.version, ui: m.ui }));
  });
  // 按 id 串行化 activate/deactivate:check-then-act 跨 await 不原子(StrictMode 双调
  // effect、快速点击会并发),串行 + 意图幂等才不会撞 Registry 的"已安装"等不变量。
  ipcMain.handle(IPC.modulesActivate, (_e, id: string) =>
    serializePerId(id, async () => {
      if (registry.status(id) === "active") return; // 幂等
      await ensureInstalled(id);
      await registry.activate(id);
    }),
  );
  ipcMain.handle(IPC.modulesDeactivate, (_e, id: string) =>
    serializePerId(id, async () => {
      if (registry.status(id) !== "unloaded") await registry.uninstall(id);
    }),
  );

  // renderer runtime → main:ctx 能力,统一按 aid 取该模块的 main 侧 ctx 执行
  ipcMain.handle(IPC.ctxGetShared, () => shared());
  ipcMain.handle(
    IPC.ctxRegisterTool,
    (_e, { aid, def }: { aid: number; def: { name: string; schema: object; description?: string } }) => {
      // handler 路由回 renderer 执行;返回的 Disposable 由 main ctx 自动 track,deactivate 时回收
      requireCtx(aid).registerTool({
        name: def.name,
        schema: def.schema,
        description: def.description,
        handler: (args) => bridge.invokeRendererTool(aid, def.name, args),
      });
    },
  );
  ipcMain.handle(IPC.ctxInvokeTool, (_e, { aid, name, args }) =>
    requireCtx(aid).invokeTool(name, args),
  );
  ipcMain.handle(IPC.ctxNotify, (_e, { aid, opts }) => requireCtx(aid).notify(opts));
  ipcMain.handle(IPC.ctxApiRequest, (_e, { aid, opts }) => requireCtx(aid).api.request(opts));
  ipcMain.handle(IPC.ctxStorage, (_e, { aid, op, key, value }) => {
    const s = requireCtx(aid).storage;
    if (op === "get") return s.get(key);
    if (op === "set") return s.set(key, value);
    if (op === "delete") return s.delete(key);
    return s.keys();
  });
  ipcMain.handle(IPC.ctxRequestLogin, (_e, { aid }) => requireCtx(aid).auth.requestLogin());
  ipcMain.handle(IPC.ctxRequestLogout, (_e, { aid }) => requireCtx(aid).auth.requestLogout());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload 要求关闭 sandbox
    },
  });

  bridge.attach(win.webContents);
  const subAuth = host.subscribeAuth((state) => {
    win.webContents.send(IPC.authChanged, state); // 壳 UI
    bridge.pushShared(shared()); // 模块 ctx 镜像
  });
  win.on("closed", () => subAuth.dispose());
  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL); // dev:vite server
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html")); // prod
  }
}

void app.whenReady().then(async () => {
  registerAppProtocol();
  registerIpc();
  createWindow();

  const wsPort = Number(process.env.BOUNDARY_WS_PORT ?? 0);
  const ws = await startWsFacade(registry.facade(), { port: wsPort });
  console.log(`[shell] WS 门面已起:ws://127.0.0.1:${ws.port}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
