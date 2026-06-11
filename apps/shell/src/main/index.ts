import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import {
  HostServices,
  Registry,
  startMcpFacade,
  startWsFacade,
} from "@boundary-desktop/host";
import type { BaseContext } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import type { ModuleEntry, SharedState } from "../shared/types.js";
import { ShellAuthDriver } from "./auth.js";
import { SessionStore } from "./auth-store.js";
import { fetchLocalStatus } from "./status.js";
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
import { ElectronWebviewDriver } from "./webview-driver.js";
import { WorkerSupervisor } from "./worker/supervisor.js";
import { WorkerApiDriver } from "./worker/api-driver.js";

// 应用 locale 锁 zh-CN(面向中文场景):navigator.language 与首选语言一致,避免系统 locale
// 漏出诡异组合成为反爬特征。注:navigator.languages 数组尾项仍来自系统,完全接管需后续 CDP 方案。
app.commandLine.appendSwitch("lang", "zh-CN");
registerAppScheme(); // 必须在 app ready 前

const bridge = new RendererBridge();
const surfaces = new SurfaceManager();
// agentworkerd 进程监管器:壳 spawn 并托管 worker 子进程,发现其本地 HTTP/WS 端点。
const worker = new WorkerSupervisor();
// 登录驱动:接 worker 本地认证 HTTP(/api/auth/*);session_token 经 safeStorage 落盘跨重启复登。
const authDriver = new ShellAuthDriver({
  baseUrl: () => worker.httpBaseUrl(),
  store: new SessionStore(join(app.getPath("userData"), "auth-session.bin")),
});
// 落盘 storage:模块 ctx.storage 跨重启留存(默认内存后端进程退出即丢)。
const host = new HostServices({
  auth: authDriver,
  // 数据面:模块 ctx.api.request → 代发到 worker 本地 HTTP(baseURL 实时取自发现到的端点)。
  api: new WorkerApiDriver(() => worker.httpBaseUrl()),
  storage: new DiskStorageBackend(
    join(app.getPath("userData"), "boundary-storage.json"),
  ),
  webview: new ElectronWebviewDriver(surfaces),
});

// 发现到 worker 端点后推进 config:模块读 config.agentworkerd.ws 自连实时 turn 流。
// 走现成 config 通道,无新契约。
worker.onDiscover((endpoints) => {
  host.updateConfig({ ...host.getConfig(), agentworkerd: endpoints });
});

// 按 active env(local/staging/prod)构造模块来源:local 扫本地、远程拉对应 catalog
const { env: activeEnv, source } = createModuleSource();
console.log(`[shell] 环境:${activeEnv}`);

// 共享依赖(react/react-dom)产物目录,经 app://vendor 提供给渲染页 import map。
// 相对 import.meta.dirname(out/main)解析:dev → apps/shell/vendor,打包 → app(.asar)/vendor;
// 不能用 process.cwd()——打包后 cwd 非 app 目录。
setVendorDir(
  process.env.BOUNDARY_VENDOR_DIR ??
    join(import.meta.dirname, "..", "..", "vendor"),
);

const registry = new Registry({
  source,
  loaders: [new RendererLoader(bridge), new ShellMainLoader()],
  capabilityHost: host,
  surfaceProvider: surfaces,
});

// 开机复登的落定信号:authGetState 等它再答。worker.start 后赋为真正的复登 promise。
let restoreSettled: Promise<unknown> = Promise.resolve();

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

/** host 侧开机激活 autostart 模块:不依赖渲染端/登录态,模块激活即注册 tool,WS/MCP 门面
 *  常驻暴露其能力(面向 agent 的对外协议无需用户先在 UI 打开该模块)。 */
async function activateAutostart(): Promise<void> {
  let modules;
  try {
    modules = (await source.catalog()).modules.filter((m) => m.autostart);
  } catch (e) {
    console.error("[shell] autostart 读 catalog 失败", e);
    return;
  }
  for (const m of modules) {
    await serializePerId(m.id, async () => {
      if (registry.status(m.id) === "active") return;
      await ensureInstalled(m.id);
      await registry.activate(m.id);
    }).catch((e) => console.error(`[shell] autostart 激活 ${m.id} 失败`, e));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.appEnv, () => activeEnv);
  // 壳 → main:运行状态页 —— 聚合状态(public,baseUrl 实时取自 supervisor 发现的端点)、
  // 壳侧信息(app 版本 + worker spawn 时刻)、手动重启
  ipcMain.handle(IPC.workerStatus, () => fetchLocalStatus(worker.httpBaseUrl()));
  ipcMain.handle(IPC.workerInfo, () => ({
    desktopVersion: app.getVersion(),
    startedAt: worker.startedAt(),
  }));
  ipcMain.handle(IPC.workerRestart, () => worker.restart());

  // 壳 → main:登录
  // 等开机复登落定再答 —— 渲染层据此决定渲染 Shell 还是 Login,避免已登录用户瞬间看到登录页。
  ipcMain.handle(IPC.authGetState, async () => {
    await restoreSettled;
    return host.getAuthState();
  });
  ipcMain.handle(IPC.authRequestLogin, () => host.requestLogin());
  ipcMain.handle(IPC.authSubmitLogin, (_e, phone: string, password: string) =>
    authDriver.submit(phone, password),
  );
  ipcMain.handle(IPC.authRequestLogout, () => host.requestLogout());
  // 个人信息页:读/改 profile、改密码,直接委托登录驱动(它持当前 session token)
  ipcMain.handle(IPC.authGetProfile, () => authDriver.getProfile());
  ipcMain.handle(
    IPC.authUpdateProfile,
    (_e, patch: { nickname?: string; preferences?: string }) =>
      authDriver.updateProfile(patch),
  );
  ipcMain.handle(IPC.authChangePassword, (_e, current: string, next: string) =>
    authDriver.changePassword(current, next),
  );

  // 壳 → main:模块导航与激活
  ipcMain.handle(IPC.modulesList, async (): Promise<ModuleEntry[]> => {
    const catalog = await source.catalog();
    return catalog.modules.map((m) => ({
      id: m.id,
      version: m.version,
      runtime: m.runtime,
      ui: m.ui,
      autostart: m.autostart,
    }));
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
  ipcMain.handle(IPC.surfaceForeground, (_e, id: string | null) =>
    surfaces.setForeground(id),
  );
  ipcMain.handle(IPC.surfaceTheme, (_e, theme: "light" | "dark") =>
    surfaces.setTheme(theme),
  );
  ipcMain.handle(IPC.surfaceMerge, (_e, id: string) => surfaces.merge(id));
  // 基座级全屏弹层开合:激活时强制隐藏主窗内所有 surface 的 native view(否则盖住 DOM 弹层)
  ipcMain.handle(IPC.surfaceOverlay, (_e, active: boolean) => surfaces.setOverlay(active));

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
  ipcMain.handle(
    IPC.windowIsFullscreen,
    (e) => winOf(e)?.isFullScreen() ?? false,
  );

  // renderer runtime → main:ctx 能力,统一按 aid 取该模块的 main 侧 ctx 执行
  ipcMain.handle(IPC.ctxGetShared, () => shared());
  ipcMain.handle(
    IPC.ctxRegisterTool,
    (
      _e,
      {
        aid,
        def,
      }: {
        aid: number;
        def: { name: string; schema: object; description?: string };
      },
    ) => {
      // handler 路由回 renderer 执行;返回的 Disposable 由 main ctx 自动 track,deactivate 时回收。
      // inv.caller 由基座在调用点注入,这里随调用一并转发给 renderer,使 renderer handler 也拿到来源。
      requireCtx(aid).registerTool({
        name: def.name,
        schema: def.schema,
        description: def.description,
        handler: (args, inv) => bridge.invokeRendererTool(aid, def.name, args, inv.caller),
      });
    },
  );
  ipcMain.handle(IPC.ctxInvokeTool, (_e, { aid, name, args }) =>
    requireCtx(aid).invokeTool(name, args),
  );
  ipcMain.handle(IPC.ctxNotify, (_e, { aid, opts }) =>
    requireCtx(aid).notify(opts),
  );
  ipcMain.handle(IPC.ctxApiRequest, (_e, { aid, opts }) =>
    requireCtx(aid).api.request(opts),
  );
  ipcMain.handle(IPC.ctxStorage, (_e, { aid, op, key, value }) => {
    const s = requireCtx(aid).storage;
    if (op === "get") return s.get(key);
    if (op === "set") return s.set(key, value);
    if (op === "delete") return s.delete(key);
    return s.keys();
  });
  ipcMain.handle(IPC.ctxRequestLogin, (_e, { aid }) =>
    requireCtx(aid).auth.requestLogin(),
  );
  ipcMain.handle(IPC.ctxRequestLogout, (_e, { aid }) =>
    requireCtx(aid).auth.requestLogout(),
  );
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
  win.on("enter-full-screen", () =>
    win.webContents.send(IPC.windowFullscreenChange, true),
  );
  win.on("leave-full-screen", () =>
    win.webContents.send(IPC.windowFullscreenChange, false),
  );
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
  // 先把 worker 拉起来:其本地 HTTP 在 bootstrap Phase 2 即就绪(早于激活),
  // 壳随后经 HTTP 驱动登录/激活,所以 spawn-first 是 worker 的原生路径。
  worker.start();
  // 开机复登:有持久化会话则复验后直接进 Shell。不阻塞建窗,authGetState 等它落定。
  restoreSettled = host.restoreLogin().catch((e: unknown) => {
    console.error("[shell] 复登失败", e);
    return false;
  });
  createWindow();

  // 能力模块开机激活(host 驱动,先于门面),其 tool 在 WS/MCP 一起来即可见。
  await activateAutostart();

  // 门面访问 token:默认随机生成(每次启动新),BOUNDARY_FACADE_TOKEN 可固定(便于配置客户端)。
  // WS 与 MCP 是同一暴露面,共用同一 token。
  const facadeToken =
    process.env.BOUNDARY_FACADE_TOKEN ?? randomBytes(24).toString("hex");

  const wsPort = Number(process.env.BOUNDARY_WS_PORT ?? 0);
  const ws = await startWsFacade(registry.facade(), {
    port: wsPort,
    token: facadeToken,
  });
  console.log(`[shell] WS 门面已起:ws://127.0.0.1:${ws.port}`);

  const mcpPort = Number(process.env.BOUNDARY_MCP_PORT ?? 0);
  const mcp = await startMcpFacade(registry.facade(), {
    port: mcpPort,
    token: facadeToken,
  });
  console.log(`[shell] MCP 门面已起:http://127.0.0.1:${mcp.port}/mcp`);
  console.log(`[shell] 门面访问 token:${facadeToken}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 退出排空:worker 还没排空就被 Electron 拆掉会留下孤儿。先拦住退出,跑完
// drain → shutdown → 等退出(超时强杀),再真正退出。
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void worker.stop().finally(() => app.quit());
});
