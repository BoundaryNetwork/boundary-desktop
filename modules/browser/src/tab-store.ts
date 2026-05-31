import type { TabMeta } from "./ipc.js";

/** 标签状态(纯数据 + 动作)。view/webContents 由 TabViewHost 据本 store 快照 diff 出来,
 *  两者解耦:store 只管"有哪些标签、哪个活动",不碰 native。每次变更触发 onChange。 */
export class TabStore {
  #tabs: TabMeta[] = [];
  #activeId: number | null = null;
  #seq = 0;
  #onChange: () => void;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  snapshot(): { tabs: TabMeta[]; activeTabId: number | null } {
    return { tabs: this.#tabs.map((t) => ({ ...t })), activeTabId: this.#activeId };
  }

  activeId(): number | null {
    return this.#activeId;
  }

  /** 新建标签并设为活动;返回其 id。url 为初始地址(空=新标签页)。 */
  open(url: string): number {
    const id = ++this.#seq;
    this.#tabs.push({ id, title: "新标签页", url, favicon: "", canGoBack: false, canGoForward: false });
    this.#activeId = id;
    this.#onChange();
    return id;
  }

  /** 关闭标签;若关掉的是活动标签,活动态落到相邻标签。返回关闭后是否已无标签。 */
  close(id: number): boolean {
    const i = this.#tabs.findIndex((t) => t.id === id);
    if (i < 0) return this.#tabs.length === 0;
    this.#tabs.splice(i, 1);
    if (this.#activeId === id) {
      this.#activeId = this.#tabs[i]?.id ?? this.#tabs[i - 1]?.id ?? null;
    }
    this.#onChange();
    return this.#tabs.length === 0;
  }

  switch(id: number): void {
    if (this.#activeId === id || !this.#tabs.some((t) => t.id === id)) return;
    this.#activeId = id;
    this.#onChange();
  }

  /** 合并某标签的导航态(来自其 webContents 事件)。 */
  update(id: number, patch: Partial<Omit<TabMeta, "id">>): void {
    const t = this.#tabs.find((t) => t.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.#onChange();
  }
}
