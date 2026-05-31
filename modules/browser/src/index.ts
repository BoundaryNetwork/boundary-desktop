// main-runtime 浏览器模块:能力(标签/导航)自包含在模块内。框架只给一块右侧区域(surface),
// 模块在区域内自排版:顶部 chrome 条(自带 toolbar 渲染页)+ 下方内容区(每标签一个内容视图)。
// Phase 2b:多标签(TabStore + TabViewHost)+ 标签条 + 地址栏导航。CDP/工具/自动化留后续。
import { fileURLToPath } from "node:url";
import { type WebContents, WebContentsView, ipcMain } from "electron";
import { defineModule, type Disposable, type MainContext, type Rect } from "@boundary-desktop/contract";
import { CH, type ChromeState, type TabMeta } from "./ipc.js";
import { TabStore } from "./tab-store.js";
import { TabViewHost } from "./tab-view-host.js";
import { browserTools } from "./tools.js";

const TOOLBAR_H = 84; // chrome 条高度(标签条 + 地址栏两行)
const START_PAGE =
  "data:text/html," +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8">' +
      '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#888">' +
      "新标签页</body>",
  );

let chromeView: WebContentsView | null = null;
let store: TabStore | null = null;
let host: TabViewHost | null = null;
let surface: MainContext["surface"] = undefined;
let theme: "light" | "dark" = "light";
const cleanups: Array<() => void> = [];

export default defineModule<MainContext>({
  async activate(ctx) {
    surface = ctx.surface;
    if (!surface) throw new Error("browser 模块需要框架分配 UI 区域(MainContext.surface)");
    const s = surface;
    theme = s.theme.get();

    // chrome 条:模块自带的 toolbar 渲染页,经 app:// + import map 载入(react 走宿主 vendor)。
    chromeView = new WebContentsView({
      webPreferences: {
        preload: fileURLToPath(new URL("./chrome/preload.mjs", import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // ESM preload 要求
        additionalArguments: [`--bd-theme=${theme}`],
      },
    });
    void chromeView.webContents.loadURL(`app://modules/${ctx.self.id}/${ctx.self.version}/chrome/index.html`);
    s.attach(chromeView);

    // 标签状态 + 内容视图宿主。store 变更 → 视图 diff + 重排 + 广播给 chrome 页。
    store = new TabStore(() => {
      host?.sync(store!.snapshot().tabs);
      relayout();
      broadcast();
    });
    host = new TabViewHost({
      attach: (v) => s.attach(v),
      bg: () => (theme === "dark" ? "#1b1e25" : "#ffffff"),
      startPage: START_PAGE,
      onNav: (id, patch) => store!.update(id, patch),
    });
    store.open(""); // 初始一个新标签页

    // 对外能力:注册 browser.* 工具(自动加前缀,经 WS/MCP/CLI 门面暴露;句柄由 ctx 自动回收)。
    for (const def of browserTools({ active: () => active(), openTab: (url) => store!.open(url) })) {
      ctx.registerTool(def);
    }

    // 区域/前台/主题变化 → 模块自排版与自显隐(框架只发状态)。
    relayout();
    track(s.bounds.subscribe(() => relayout()));
    track(s.visible.subscribe(() => relayout()));
    track(
      s.theme.subscribe((t) => {
        theme = t;
        chromeView?.setBackgroundColor(theme === "dark" ? "#1b1e25" : "#ffffff");
        host?.repaint();
        broadcast();
      }),
    );

    // chrome 页 → main 指令(仅采信 chrome 页自身的发送者)。
    listen(CH.ready, (e) => chrome(e) && broadcast()); // 页面订阅就绪 → 推当前全量态
    listen(CH.navigate, (e, url) => {
      if (chrome(e) && typeof url === "string" && url) void active()?.loadURL(url);
    });
    listen(CH.back, (e) => chrome(e) && active()?.navigationHistory.goBack());
    listen(CH.forward, (e) => chrome(e) && active()?.navigationHistory.goForward());
    listen(CH.reload, (e) => chrome(e) && active()?.reload());
    listen(CH.newTab, (e) => chrome(e) && store!.open(""));
    listen(CH.switchTab, (e, id) => chrome(e) && typeof id === "number" && store!.switch(id));
    listen(CH.closeTab, (e, id) => {
      if (chrome(e) && typeof id === "number" && store!.close(id)) store!.open(""); // 关到空则补一个
    });
  },

  deactivate() {
    for (const c of cleanups.splice(0)) c();
    host?.destroyAll();
    if (chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.close();
    chromeView = null;
    store = null;
    host = null;
    surface = undefined;
  },
});

/** chrome 条铺区域顶部、内容区占其下;非前台时整体隐藏(框架只发 visible,显隐由模块落地)。 */
function relayout(): void {
  if (!surface) return;
  const region = surface.bounds.get();
  const visible = surface.visible.get();
  if (chromeView) {
    chromeView.setVisible(visible);
    chromeView.setBounds({ x: region.x, y: region.y, width: region.width, height: TOOLBAR_H });
  }
  const content: Rect = {
    x: region.x,
    y: region.y + TOOLBAR_H,
    width: region.width,
    height: Math.max(0, region.height - TOOLBAR_H),
  };
  host?.layout(content, visible, store?.activeId() ?? null);
}

function broadcast(): void {
  const cwc = chromeView?.webContents;
  if (!cwc || cwc.isDestroyed() || !store) return;
  const snap = store.snapshot();
  const state: ChromeState = { tabs: snap.tabs as TabMeta[], activeTabId: snap.activeTabId, theme };
  cwc.send(CH.state, state);
}

function active(): WebContents | null {
  return host?.webContents(store?.activeId() ?? null) ?? null;
}

function chrome(e: Electron.IpcMainEvent): boolean {
  return e.sender === chromeView?.webContents;
}

function track(d: Disposable): void {
  cleanups.push(() => d.dispose());
}

function listen(channel: string, handler: (e: Electron.IpcMainEvent, arg: unknown) => void): void {
  const h = (e: Electron.IpcMainEvent, arg: unknown): void => {
    handler(e, arg);
  };
  ipcMain.on(channel, h);
  cleanups.push(() => ipcMain.removeListener(channel, h));
}
