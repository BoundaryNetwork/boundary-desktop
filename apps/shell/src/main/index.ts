import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { HostServices, Registry, startMcpFacade, startWsFacade } from "@boundary-desktop/host";
import type { BaseContext } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import type { ModuleEntry, SharedState } from "../shared/types.js";
import { ShellAuthDriver } from "./auth.js";
import {
  registerAppProtocol,
  registerAppProtocolForSession,
  registerAppScheme,
  setVendorDir,
} from "./app-protocol.js";
import { createModuleSource } from "./env.js";
import { RendererBridge } from "./renderer-bridge.js";
import { RendererLoader } from "./renderer-loader.js";
import { ShellMainLoader } from "./main-loader.js";
import { SurfaceManager } from "./surface.js";
import { DiskStorageBackend } from "./storage.js";

registerAppScheme(); // 必须在 app ready 前

const authDriver = new ShellAuthDriver();
// 落盘 storage:模块 ctx.storage 跨重启留存(默认内存后端进程退出即丢)。
const host = new HostServices({
  auth: authDriver,
  storage: new DiskStorageBackend(join(app.getPath("userData"), "boundary-storage.json")),
});
const bridge = new RendererBridge();
const surfaces = new SurfaceManager();

// 按 active env(local/staging/prod)构造模块来源:local 扫本地、远程拉对应 catalog
const { env: activeEnv, source } = createModuleSource();
console.log(`[shell] 环境:${activeEnv}`);

// 共享依赖(react/react-dom)产物目录,经 app://vendor 提供给渲染页 import map。
// 相对 import.meta.dirname(out/main)解析:dev → apps/shell/vendor,打包 → app(.asar)/vendor;
// 不能用 process.cwd()——打包后 cwd 非 app 目录。
setVendorDir(process.env.BOUNDARY_VENDOR_DIR ?? join(import.meta.dirname, "..", "..", "vendor"));

const registry = new Registry({
  source,
  loaders: [new RendererLoader(bridge), new ShellMainLoader()],
  capabilityHost: host,
  surfaceProvider: surfaces,
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
    return catalog.modules.map((m) => ({ id: m.id, version: m.version, runtime: m.runtime, ui: m.ui }));
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

  // 壳 → main:前台模块 / 主题上报,驱动 main 模块的 surface 显隐与主题
  ipcMain.handle(IPC.surfaceForeground, (_e, id: string | null) => surfaces.setForeground(id));
  ipcMain.handle(IPC.surfaceTheme, (_e, theme: "light" | "dark") => surfaces.setTheme(theme));
  ipcMain.handle(IPC.surfaceMerge, (_e, id: string) => surfaces.merge(id));

  // 壳 → main:无边框窗口自绘红绿灯的窗口控制(按事件来源 webContents 定位窗口)。
  const winOf = (e: { sender: Electron.WebContents }): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender);
  ipcMain.handle(IPC.windowMinimize, (e) => winOf(e)?.minimize());
  ipcMain.handle(IPC.windowClose, (e) => winOf(e)?.close());
  ipcMain.handle(IPC.windowToggleMaximize, (e) => {
    const w = winOf(e);
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.handle(IPC.windowToggleFullscreen, (e) => {
    const w = winOf(e);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  ipcMain.handle(IPC.windowIsFocused, (e) => winOf(e)?.isFocused() ?? false);
  ipcMain.handle(IPC.windowIsFullscreen, (e) => winOf(e)?.isFullScreen() ?? false);

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
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    // macOS:整窗无边框,渲染端在 LeftRail 顶自绘小号红绿灯(系统红绿灯无法控制大小)。
    // frame=false + setWindowButtonVisibility(false) 完全接管标题栏视觉;Win/Linux 走系统原生标题栏。
    frame: isMac ? false : true,
    titleBarStyle: isMac ? "hidden" : "default",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload 要求关闭 sandbox
    },
  });

  // 自绘红绿灯:frame=false 仍隐式保留三颗系统按钮,需显式隐藏。
  if (isMac) win.setWindowButtonVisibility(false);

  bridge.attach(win.webContents);
  surfaces.attachWindow(win);
  const subAuth = host.subscribeAuth((state) => {
    win.webContents.send(IPC.authChanged, state); // 壳 UI
    bridge.pushShared(shared()); // 模块 ctx 镜像
  });
  // 自绘红绿灯依赖窗口活跃 / 全屏态;点内嵌浏览器 view 只让 renderer webContents 失焦、
  // 窗口本身仍活跃,故用窗口级 focus/blur 事件而非渲染端 window.onblur。
  win.on("focus", () => win.webContents.send(IPC.windowFocusChange, true));
  win.on("blur", () => win.webContents.send(IPC.windowFocusChange, false));
  win.on("enter-full-screen", () => win.webContents.send(IPC.windowFullscreenChange, true));
  win.on("leave-full-screen", () => win.webContents.send(IPC.windowFullscreenChange, false));
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
  // 模块内容视图用自有 partition(非默认 session),给每个新建 session 也注册 app:// 处理器,
  // 让 partition 里的页面(如浏览器 newtab 主页)能经 app:// 载入模块资产。
  app.on("session-created", (ses) => {
    if (ses !== session.defaultSession) registerAppProtocolForSession(ses);
  });
  registerIpc();
  createWindow();

  const wsPort = Number(process.env.BOUNDARY_WS_PORT ?? 0);
  const ws = await startWsFacade(registry.facade(), { port: wsPort });
  console.log(`[shell] WS 门面已起:ws://127.0.0.1:${ws.port}`);

  const mcpPort = Number(process.env.BOUNDARY_MCP_PORT ?? 0);
  const mcp = await startMcpFacade(registry.facade(), { port: mcpPort });
  console.log(`[shell] MCP 门面已起:http://127.0.0.1:${mcp.port}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
