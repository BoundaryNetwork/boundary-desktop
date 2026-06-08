import { Menu, type MenuItemConstructorOptions } from "electron";
import type { Disposable, Rect, WebviewContextMenu, WebviewCreateOptions, WebviewHandle } from "@boundary-desktop/contract";
import type { TabMeta } from "./ipc.js";

interface HostDeps {
  /** 经 kernel 造一块绑定到模块 surface 的 view(profile 分区隔离)。 */
  create: (opts: WebviewCreateOptions) => Promise<WebviewHandle>;
  /** 空地址的新标签页。 */
  startPage: string;
  /** 某标签导航态变化(喂回 TabStore)。 */
  onNav: (id: number, patch: Partial<Omit<TabMeta, "id">>) => void;
}

/** 每标签一个 kernel view(WebviewHandle)。view 由 kernel 持有/绑 surface;导航事件、右键菜单经 handle.on。 */
export class TabViewHost {
  #views = new Map<number, { handle: WebviewHandle | null; subs: Disposable[]; ready: Promise<void> }>();
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

  /** 句柄就绪后才可驱动;tools 的 active() 经此取(见 index.ts active())。 */
  handle(id: number | null): WebviewHandle | null {
    return id != null ? (this.#views.get(id)?.handle ?? null) : null;
  }

  /** 内容区布局 + 可见性:只活动标签可见,非前台(visible=false)全隐。 */
  layout(rect: Rect, visible: boolean, activeId: number | null): void {
    for (const [id, e] of this.#views) {
      e.handle?.setBounds(rect);
      e.handle?.setVisible(visible && id === activeId);
    }
  }

  destroyAll(): void {
    for (const id of [...this.#views.keys()]) this.#destroy(id);
  }

  #create(id: number, url: string, profileId: string): void {
    const subs: Disposable[] = [];
    const entry: { handle: WebviewHandle | null; subs: Disposable[]; ready: Promise<void> } = { handle: null, subs, ready: Promise.resolve() };
    entry.ready = this.#deps.create({ profileId, interactive: true }).then((handle) => {
      entry.handle = handle;
      const nav = (p: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }): void => {
        // 新标签页(模块自带 newtab,经 app:// 载入)地址栏留空,不暴露内部 URL。
        const blank = p.url.startsWith("data:") || p.url.includes("/newtab/index.html");
        this.#deps.onNav(id, { url: blank ? "" : p.url, title: p.title, canGoBack: p.canGoBack, canGoForward: p.canGoForward });
      };
      subs.push(handle.on("did-navigate", nav));
      subs.push(handle.on("did-navigate-in-page", nav));
      subs.push(handle.on("title-updated", (p) => this.#deps.onNav(id, { title: p.title })));
      subs.push(handle.on("favicon-updated", (p) => this.#deps.onNav(id, { favicon: p.favicon })));
      subs.push(handle.on("context-menu", (p) => this.#contextMenu(handle, p)));
      void handle.navigate(url || this.#deps.startPage);
    });
    this.#views.set(id, entry);
  }

  #contextMenu(handle: WebviewHandle, p: WebviewContextMenu): void {
    const items: MenuItemConstructorOptions[] = [
      { label: "后退", enabled: p.canGoBack, click: () => handle.goBack() },
      { label: "前进", enabled: p.canGoForward, click: () => handle.goForward() },
      { label: "重新加载", click: () => handle.reload() },
      { type: "separator" },
      { label: "复制", role: "copy", enabled: p.editFlags.canCopy },
      { label: "粘贴", role: "paste", enabled: p.editFlags.canPaste },
      { label: "全选", role: "selectAll" },
    ];
    Menu.buildFromTemplate(items).popup();
  }

  #destroy(id: number): void {
    const e = this.#views.get(id);
    if (!e) return;
    this.#views.delete(id);
    void e.ready.then(() => {
      for (const s of e.subs) s.dispose();
      e.handle?.dispose(); // kernel 销毁 view
    });
  }
}
