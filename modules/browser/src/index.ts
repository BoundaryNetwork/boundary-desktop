// main-runtime 浏览器模块:能力(标签/导航)自包含在模块内。框架只给一块右侧区域(surface),
// 模块在区域内自排版:顶部 chrome 条(自带 toolbar 渲染页)+ 下方内容区(每标签一个内容视图)。
// Phase 2b:多标签(TabStore + TabViewHost)+ 标签条 + 地址栏导航。CDP/工具/自动化留后续。
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Menu, type MenuItemConstructorOptions, app, type WebContents, WebContentsView, ipcMain } from "electron";
import { defineModule, type Disposable, type MainContext, type Rect } from "@boundary-desktop/contract";
import { CH, type ChromeState, type GroupColor, type TabMeta } from "./ipc.js";
import { TabStore } from "./tab-store.js";
import { TabViewHost } from "./tab-view-host.js";
import { browserTools } from "./tools.js";
import { automationTools } from "./automation-tools.js";
import { Runner } from "./runner.js";

const TOOLBAR_H = 88; // chrome 条高度(tab 条 40 + 导航栏 48,与 openclaw #toolbar 对齐)

let chromeView: WebContentsView | null = null;
let store: TabStore | null = null;
let host: TabViewHost | null = null;
let runner: Runner | null = null;
let surface: MainContext["surface"] = undefined;
let theme: "light" | "dark" = "light";
let profileSeq = 0;
const profiles = new Map<string, string>([["default", "默认"]]); // 账号(profile)id → 名;各自分区隔离
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

    // 新标签页 = 模块自带的 newtab 主页(经 app:// 载入,内容视图内 location.href 导航)。
    const userName = ctx.auth.get().user?.name ?? "";
    const newtabUrl =
      `app://modules/${ctx.self.id}/${ctx.self.version}/newtab/index.html?u=${encodeURIComponent(userName)}`;

    // 标签状态 + 内容视图宿主。store 变更 → 视图 diff + 重排 + 广播给 chrome 页。
    store = new TabStore(() => {
      host?.sync(store!.snapshot().tabs);
      relayout();
      broadcast();
    });
    host = new TabViewHost({
      attach: (v) => s.attach(v),
      bg: () => (theme === "dark" ? "#1b1e25" : "#ffffff"),
      startPage: newtabUrl,
      onNav: (id, patch) => store!.update(id, patch),
    });
    store.open(""); // 初始一个新标签页

    // 对外能力:注册 browser.* 工具(自动加前缀,经 WS/MCP/CLI 门面暴露;句柄由 ctx 自动回收)。
    for (const def of browserTools({ active: () => active(), openTab: (url) => store!.open(url) })) {
      ctx.registerTool(def);
    }
    // automation.* 工具:内置 DSL 脚本(随包到 dist/scripts)+ 串行 runner。
    const scriptsDir = fileURLToPath(new URL("./scripts/", import.meta.url));
    // 运行产物落模块自有 userData 目录(session capture,跨会话可读)。
    runner = new Runner(join(app.getPath("userData"), "boundary-browser", "runs"));
    for (const def of automationTools({ scriptsDir, active: () => active(), runner })) {
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
    track(s.detached.subscribe(() => broadcast())); // 分离态变更 → chrome 页切 分离/合并 按钮

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
    listen(CH.detach, (e) => chrome(e) && void s.detach());
    listen(CH.merge, (e) => chrome(e) && void s.merge());
    listen(CH.tabMenu, (e, payload) => {
      if (chrome(e) && payload && typeof payload === "object") showTabMenu((payload as { tabId?: unknown }).tabId);
    });
    listen(CH.groupCollapse, (e, payload) => {
      const p = payload as { groupId?: unknown };
      if (chrome(e) && typeof p?.groupId === "number") {
        store!.setGroupCollapsed(p.groupId, !store!.groups().find((g) => g.id === p.groupId)?.collapsed);
      }
    });
    listen(CH.groupRename, (e, payload) => {
      const p = payload as { groupId?: unknown; name?: unknown };
      if (chrome(e) && typeof p?.groupId === "number" && typeof p?.name === "string") store!.renameGroup(p.groupId, p.name);
    });
    listen(CH.dragTab, (e, payload) => {
      const p = payload as { tabId?: unknown; beforeId?: unknown; groupId?: unknown };
      if (chrome(e) && typeof p?.tabId === "number") {
        const beforeId = typeof p.beforeId === "number" ? p.beforeId : null;
        const groupId = typeof p.groupId === "number" ? p.groupId : null;
        store!.dragTab(p.tabId, beforeId, groupId);
      }
    });
    listen(CH.profileMenu, (e) => chrome(e) && showProfileMenu());
  },

  deactivate() {
    for (const c of cleanups.splice(0)) c();
    host?.destroyAll();
    if (chromeView && !chromeView.webContents.isDestroyed()) chromeView.webContents.close();
    chromeView = null;
    store = null;
    host = null;
    runner = null;
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
  const state: ChromeState = {
    tabs: snap.tabs as TabMeta[],
    groups: snap.groups,
    activeTabId: snap.activeTabId,
    theme,
    detached: surface?.detached.get() ?? false,
    currentProfile: profiles.get(store.currentProfile()) ?? store.currentProfile(),
  };
  cwc.send(CH.state, state);
}

/** 账号(profile)切换原生菜单:列出现有账号(✓ 当前)+ 新建账号。新建即切到该账号,
 *  后续新标签页用其分区(persist:browser-<id>),与其它账号 cookie/storage 隔离。 */
function showProfileMenu(): void {
  if (!store) return;
  const cur = store.currentProfile();
  const items: MenuItemConstructorOptions[] = [...profiles.entries()].map(([id, name]) => ({
    label: (id === cur ? "✓ " : "  ") + name,
    click: () => store?.setCurrentProfile(id),
  }));
  items.push(
    { type: "separator" },
    {
      label: "新建账号",
      click: () => {
        const id = `profile-${++profileSeq}`;
        profiles.set(id, `账号 ${profiles.size}`);
        store?.setCurrentProfile(id);
      },
    },
  );
  Menu.buildFromTemplate(items).popup();
}

const COLOR_LABELS: Array<[GroupColor, string]> = [
  ["blue", "蓝"], ["red", "红"], ["orange", "橙"], ["yellow", "黄"], ["green", "绿"],
  ["cyan", "青"], ["purple", "紫"], ["pink", "粉"], ["grey", "灰"],
];

/** 右键标签:原生菜单(含分组操作)。原生 Menu 浮于 OS 层,不被 88px 工具栏条裁剪。 */
function showTabMenu(tabId: unknown): void {
  if (typeof tabId !== "number" || !store) return;
  const gid = store.groupOf(tabId);
  const items: MenuItemConstructorOptions[] = [];
  if (gid == null) {
    items.push({ label: "加入新分组", click: () => store?.createGroupFromTab(tabId) });
    const others = store.groups();
    if (others.length) {
      items.push({
        label: "加入分组",
        submenu: others.map((g) => ({
          label: g.name || `分组 ${g.id}`,
          click: () => store?.addToGroup(tabId, g.id),
        })),
      });
    }
  } else {
    items.push({ label: "移出分组", click: () => store?.removeFromGroup(tabId) });
    items.push({
      label: "分组颜色",
      submenu: COLOR_LABELS.map(([c, label]) => ({ label, click: () => store?.setGroupColor(gid, c) })),
    });
    items.push({ label: "取消分组", click: () => store?.ungroup(gid) });
    items.push({ label: "关闭分组", click: () => store?.closeGroup(gid) && store?.open("") });
  }
  const pinned = store.pinnedOf(tabId);
  items.push({ type: "separator" });
  items.push({ label: pinned ? "取消固定" : "固定标签", click: () => store?.setPinned(tabId, !pinned) });
  items.push({ label: "关闭标签", click: () => store?.close(tabId) && store?.open("") });
  Menu.buildFromTemplate(items).popup();
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
