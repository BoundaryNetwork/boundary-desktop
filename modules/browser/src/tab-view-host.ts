import { type WebContents, WebContentsView } from "electron";
import type { Disposable, Rect } from "@boundary-desktop/contract";
import type { TabMeta } from "./ipc.js";

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
    for (const t of tabs) if (!this.#views.has(t.id)) this.#create(t.id, t.url);
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

  #create(id: number, url: string): void {
    // 浏览器自有持久会话分区:与壳默认 session 隔离(独立 cookie/storage),热拔不污染宿主。
    // 多账号(per-profile)时改成 `persist:browser-<profileId>` + ctx.storage 存账号元信息(Phase 5 余)。
    const view = new WebContentsView({
      webPreferences: { partition: "persist:browser", contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view.setBackgroundColor(this.#deps.bg());
    const wc = view.webContents;
    const nav = (): void => this.#deps.onNav(id, navPatch(wc));
    wc.on("did-navigate", nav);
    wc.on("did-navigate-in-page", nav);
    wc.on("page-title-updated", () => this.#deps.onNav(id, { title: wc.getTitle() }));
    wc.on("page-favicon-updated", (_e, icons) => this.#deps.onNav(id, { favicon: icons[0] ?? "" }));
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
  return {
    url: url.startsWith("data:") ? "" : url,
    title: wc.getTitle(),
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
  };
}
