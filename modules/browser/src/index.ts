// main-runtime 浏览器模块:能力(view/导航)自包含在模块内。框架只给一块右侧区域(surface),
// 模块在区域内自排版:顶部 chrome 条(自带的 toolbar 渲染页)+ 下方内容视图。
// Phase 2a:单内容视图 + 地址栏/前进后退/刷新。多标签(TabStore/tab 条)留 Phase 2b。
import { fileURLToPath } from "node:url";
import { type WebContents, WebContentsView, ipcMain } from "electron";
import { defineModule, type Disposable, type MainContext, type Rect } from "@boundary-desktop/contract";
import { CH, type ChromeState } from "./ipc.js";

const TOOLBAR_H = 44; // chrome 条高度(DIP)
const START_PAGE =
  "data:text/html," +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8">' +
      '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#888">' +
      "新标签页</body>",
  );

let chromeView: WebContentsView | null = null;
let contentView: WebContentsView | null = null;
let theme: "light" | "dark" = "light";
const cleanups: Array<() => void> = [];

export default defineModule<MainContext>({
  async activate(ctx) {
    const surface = ctx.surface;
    if (!surface) throw new Error("browser 模块需要框架分配 UI 区域(MainContext.surface)");
    theme = surface.theme.get();

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

    // 内容视图(当前为单标签;Phase 2b 改为每标签一个)。
    contentView = new WebContentsView();
    paintBg(contentView);
    void contentView.webContents.loadURL(START_PAGE);

    surface.attach(chromeView); // 句柄由 ctx 自动 track,deactivate 时框架摘除
    surface.attach(contentView);

    // 区域/前台/主题变化 → 模块自排版与自显隐(框架只发状态)。
    layout(surface.bounds.get(), surface.visible.get());
    track(surface.bounds.subscribe((b) => layout(b, surface.visible.get())));
    track(surface.visible.subscribe((v) => layout(surface.bounds.get(), v)));
    track(
      surface.theme.subscribe((t) => {
        theme = t;
        if (contentView) paintBg(contentView);
        pushState();
      }),
    );

    // 内容视图导航态 → 推给 chrome 页(地址栏/前进后退可用性)。
    const wc = contentView.webContents;
    const onNav = (): void => pushState();
    wc.on("did-navigate", onNav);
    wc.on("did-navigate-in-page", onNav);
    wc.on("page-title-updated", onNav);
    chromeView.webContents.on("did-finish-load", onNav); // chrome 页就绪即喂初始态

    // chrome 页 → main 指令(仅采信 chrome 页自身的发送者)。
    listen(CH.navigate, (e, url) => {
      if (isChrome(e.sender) && typeof url === "string" && url) void contentView?.webContents.loadURL(url);
    });
    listen(CH.back, (e) => {
      if (isChrome(e.sender)) contentView?.webContents.navigationHistory.goBack();
    });
    listen(CH.forward, (e) => {
      if (isChrome(e.sender)) contentView?.webContents.navigationHistory.goForward();
    });
    listen(CH.reload, (e) => {
      if (isChrome(e.sender)) contentView?.webContents.reload();
    });
  },

  deactivate() {
    for (const c of cleanups.splice(0)) c();
    if (contentView && !contentView.webContents.isDestroyed()) contentView.webContents.close();
    if (chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.close();
    contentView = null;
    chromeView = null;
  },
});

/** chrome 条铺区域顶部、内容视图占其下;非前台时整体隐藏(框架只发 visible 状态,显隐由模块落地)。 */
function layout(region: Rect, visible: boolean): void {
  if (chromeView) {
    chromeView.setVisible(visible);
    chromeView.setBounds({ x: region.x, y: region.y, width: region.width, height: TOOLBAR_H });
  }
  if (contentView) {
    contentView.setVisible(visible);
    contentView.setBounds({
      x: region.x,
      y: region.y + TOOLBAR_H,
      width: region.width,
      height: Math.max(0, region.height - TOOLBAR_H),
    });
  }
}

function pushState(): void {
  const wc = contentView?.webContents;
  const cwc = chromeView?.webContents;
  if (!wc || !cwc || cwc.isDestroyed() || wc.isDestroyed()) return;
  const nav = wc.navigationHistory;
  const state: ChromeState = {
    url: wc.getURL().startsWith("data:") ? "" : wc.getURL(),
    title: wc.getTitle(),
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
    theme,
  };
  cwc.send(CH.state, state);
}

function paintBg(view: WebContentsView): void {
  view.setBackgroundColor(theme === "dark" ? "#1b1e25" : "#ffffff");
}

function isChrome(sender: WebContents): boolean {
  return sender === chromeView?.webContents;
}

function track(d: Disposable): void {
  cleanups.push(() => d.dispose());
}

function listen(channel: string, handler: (e: Electron.IpcMainEvent, arg: unknown) => void): void {
  const h = (e: Electron.IpcMainEvent, arg: unknown): void => handler(e, arg);
  ipcMain.on(channel, h);
  cleanups.push(() => ipcMain.removeListener(channel, h));
}
