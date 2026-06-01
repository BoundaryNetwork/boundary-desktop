import { Menu, type MenuItemConstructorOptions, type WebContents, WebContentsView, app } from "electron";
import type { Disposable, Rect } from "@boundary-desktop/contract";
import type { TabMeta } from "./ipc.js";

const ACCEPT_LANGUAGES = "zh-CN,zh;q=0.9,en;q=0.8";

/** 干净的桌面 Chrome UA:去掉默认 Electron UA 里的 `Electron/x` 与 app product token
 *  (`<name>/<ver>`,位于 "(KHTML, like Gecko)" 与 "Chrome/" 之间)。否则反爬一眼识别
 *  "Electron" / 自定义应用名,判为机器人(unusual traffic)。Chrome 版本保留真实值,
 *  与 userAgentData / 引擎一致,避免不自洽反成新特征。 */
let cleanUA: string | null = null;
function contentUserAgent(): string {
  if (cleanUA) return cleanUA;
  cleanUA = app.userAgentFallback
    .replace(/ Electron\/[\d.]+/, "")
    .replace(/(\(KHTML, like Gecko\)) \S+ (Chrome\/)/, "$1 $2");
  return cleanUA;
}

interface HostDeps {
  /** 把 view 挂到框架区域(= surface.attach);返回的句柄在标签销毁时 dispose(摘除)。 */
  attach: (view: object) => Disposable;
  /** 内容视图背景色(随主题,防白闪)。 */
  bg: () => string;
  /** 空地址的新标签页。 */
  startPage: string;
  /** 某标签导航态变化(喂回 TabStore)。 */
  onNav: (id: number, patch: Partial<Omit<TabMeta, "id">>) => void;
}

/** 每标签一个 WebContentsView,据 TabStore 快照 diff 出生灭。view 的成员关系经 surface.attach
 *  归框架;webContents 的创建/销毁、导航事件归模块。 */
export class TabViewHost {
  #views = new Map<number, { view: WebContentsView; detach: Disposable }>();
  #deps: HostDeps;

  constructor(deps: HostDeps) {
    this.#deps = deps;
  }

  /** 据快照 diff:新增标签建 view,消失标签销毁 view。 */
  sync(tabs: TabMeta[]): void {
    const live = new Set(tabs.map((t) => t.id));
    for (const id of [...this.#views.keys()]) if (!live.has(id)) this.#destroy(id);
    for (const t of tabs) if (!this.#views.has(t.id)) this.#create(t.id, t.url, t.profileId ?? "default");
  }

  webContents(id: number | null): WebContents | null {
    return id != null ? (this.#views.get(id)?.view.webContents ?? null) : null;
  }

  /** 内容区布局 + 可见性:只活动标签可见,非前台(visible=false)全隐。 */
  layout(rect: Rect, visible: boolean, activeId: number | null): void {
    for (const [id, { view }] of this.#views) {
      view.setBounds(rect);
      view.setVisible(visible && id === activeId);
    }
  }

  repaint(): void {
    for (const { view } of this.#views.values()) view.setBackgroundColor(this.#deps.bg());
  }

  destroyAll(): void {
    for (const id of [...this.#views.keys()]) this.#destroy(id);
  }

  #create(id: number, url: string, profileId: string): void {
    // 浏览器自有持久会话分区,按账号(profile)隔离 cookie/storage,且与壳默认 session 隔离。
    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:browser-${profileId}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor(this.#deps.bg());
    const wc = view.webContents;
    // 反爬基本款:内容视图伪装成普通桌面 Chrome(去 Electron/app token),Accept-Language 设 zh-CN。
    // 设在分区 session 上(UA + Accept-Language 一起),loadURL 前生效、覆盖该 profile 全部标签。
    wc.session.setUserAgent(contentUserAgent(), ACCEPT_LANGUAGES);
    const nav = (): void => this.#deps.onNav(id, navPatch(wc));
    wc.on("did-navigate", nav);
    wc.on("did-navigate-in-page", nav);
    wc.on("page-title-updated", () => this.#deps.onNav(id, { title: wc.getTitle() }));
    wc.on("page-favicon-updated", (_e, icons) => this.#deps.onNav(id, { favicon: icons[0] ?? "" }));
    wc.on("context-menu", (_e, params) => {
      if (wc.isDestroyed()) return;
      const nav = wc.navigationHistory;
      const items: MenuItemConstructorOptions[] = [
        { label: "后退", enabled: nav.canGoBack(), click: () => !wc.isDestroyed() && nav.goBack() },
        { label: "前进", enabled: nav.canGoForward(), click: () => !wc.isDestroyed() && nav.goForward() },
        { label: "重新加载", click: () => !wc.isDestroyed() && wc.reload() },
        { type: "separator" },
        { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
        { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
        { label: "全选", role: "selectAll" },
      ];
      // 仅 dev 提供检查元素;打包构建不出现调试入口。
      if (!app.isPackaged) {
        items.push(
          { type: "separator" },
          { label: "检查元素", click: () => !wc.isDestroyed() && wc.inspectElement(params.x, params.y) },
        );
      }
      Menu.buildFromTemplate(items).popup();
    });
    const detach = this.#deps.attach(view);
    void wc.loadURL(url || this.#deps.startPage);
    this.#views.set(id, { view, detach });
  }

  #destroy(id: number): void {
    const e = this.#views.get(id);
    if (!e) return;
    this.#views.delete(id);
    e.detach.dispose(); // 框架:从窗口摘除
    if (!e.view.webContents.isDestroyed()) e.view.webContents.close(); // 模块:销毁 webContents
  }
}

function navPatch(wc: WebContents): Partial<Omit<TabMeta, "id">> {
  const nav = wc.navigationHistory;
  const url = wc.getURL();
  // 新标签页(模块自带 newtab,经 app:// 载入)地址栏留空,不暴露内部 URL。
  const blank = url.startsWith("data:") || url.includes("/newtab/index.html");
  return {
    url: blank ? "" : url,
    title: wc.getTitle(),
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
  };
}
