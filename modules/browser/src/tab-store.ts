import type { GroupColor, TabGroup, TabMeta } from "./ipc.js";

const GROUP_COLORS: GroupColor[] = ["blue", "red", "orange", "yellow", "green", "cyan", "purple", "pink", "grey"];

/** 同组标签拉成连续(对标 Chrome,否则渲染端把一个组拆成多段彩条):每个组在其首个成员
 *  出现的位置就地展开全部成员,无组标签留原位。稳定、幂等。(港 openclaw enforceGroupContiguity) */
function enforceGroupContiguity(tabs: TabMeta[]): TabMeta[] {
  const result: TabMeta[] = [];
  const placed = new Set<number>();
  for (const t of tabs) {
    if (t.groupId == null) {
      result.push(t);
      continue;
    }
    if (placed.has(t.groupId)) continue;
    placed.add(t.groupId);
    for (const o of tabs) if (o.groupId === t.groupId) result.push(o);
  }
  return result;
}

/** 标签状态(纯数据 + 动作)+ 分组。view/webContents 由 TabViewHost 据快照 diff 出来。
 *  每次变更先把同组标签拉连续,再触发 onChange。 */
export class TabStore {
  #tabs: TabMeta[] = [];
  #groups = new Map<number, TabGroup>();
  #activeId: number | null = null;
  #seq = 0;
  #groupSeq = 0;
  #onChange: () => void;

  constructor(onChange: () => void) {
    this.#onChange = onChange;
  }

  snapshot(): { tabs: TabMeta[]; groups: TabGroup[]; activeTabId: number | null } {
    return {
      tabs: this.#tabs.map((t) => ({ ...t })),
      groups: [...this.#groups.values()],
      activeTabId: this.#activeId,
    };
  }

  activeId(): number | null {
    return this.#activeId;
  }

  open(url: string): number {
    const id = ++this.#seq;
    this.#tabs.push({ id, title: "新标签页", url, favicon: "", canGoBack: false, canGoForward: false });
    this.#activeId = id;
    this.#emit();
    return id;
  }

  close(id: number): boolean {
    const i = this.#tabs.findIndex((t) => t.id === id);
    if (i < 0) return this.#tabs.length === 0;
    const groupId = this.#tabs[i]!.groupId;
    this.#tabs.splice(i, 1);
    if (this.#activeId === id) this.#activeId = this.#tabs[i]?.id ?? this.#tabs[i - 1]?.id ?? null;
    if (groupId != null) this.#pruneGroup(groupId);
    this.#emit();
    return this.#tabs.length === 0;
  }

  switch(id: number): void {
    if (this.#activeId === id || !this.#tabs.some((t) => t.id === id)) return;
    this.#activeId = id;
    this.#emit();
  }

  update(id: number, patch: Partial<Omit<TabMeta, "id">>): void {
    const t = this.#tabs.find((t) => t.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.#emit();
  }

  // --- 分组 ---

  createGroupFromTab(tabId: number): void {
    const t = this.#tabs.find((t) => t.id === tabId);
    if (!t) return;
    const id = ++this.#groupSeq;
    this.#groups.set(id, { id, name: "", color: GROUP_COLORS[(id - 1) % GROUP_COLORS.length]! });
    t.groupId = id;
    this.#emit();
  }

  addToGroup(tabId: number, groupId: number): void {
    const t = this.#tabs.find((t) => t.id === tabId);
    if (!t || !this.#groups.has(groupId)) return;
    const old = t.groupId;
    t.groupId = groupId;
    if (old != null && old !== groupId) this.#pruneGroup(old);
    this.#emit();
  }

  removeFromGroup(tabId: number): void {
    const t = this.#tabs.find((t) => t.id === tabId);
    if (!t || t.groupId == null) return;
    const old = t.groupId;
    t.groupId = undefined;
    this.#pruneGroup(old);
    this.#emit();
  }

  setPinned(id: number, pinned: boolean): void {
    const t = this.#tabs.find((t) => t.id === id);
    if (!t) return;
    t.pinned = pinned;
    if (pinned && t.groupId != null) {
      const old = t.groupId;
      t.groupId = undefined; // 固定标签不参与分组
      this.#pruneGroup(old);
    }
    this.#emit();
  }

  pinnedOf(id: number): boolean {
    return this.#tabs.find((t) => t.id === id)?.pinned ?? false;
  }

  /** 拖拽:把 tabId 移到 beforeId 之前(null=末尾)并设分组(null=无组)。(港 openclaw dragTab) */
  dragTab(tabId: number, beforeId: number | null, groupId: number | null): void {
    const i = this.#tabs.findIndex((t) => t.id === tabId);
    if (i < 0) return;
    const t = this.#tabs[i]!;
    const old = t.groupId;
    t.groupId = groupId != null && this.#groups.has(groupId) ? groupId : undefined;
    this.#tabs.splice(i, 1);
    const j = beforeId == null ? -1 : this.#tabs.findIndex((x) => x.id === beforeId);
    if (j < 0) this.#tabs.push(t);
    else this.#tabs.splice(j, 0, t);
    if (old != null && old !== t.groupId) this.#pruneGroup(old);
    this.#emit();
  }

  setGroupColor(groupId: number, color: GroupColor): void {
    const g = this.#groups.get(groupId);
    if (!g) return;
    g.color = color;
    this.#emit();
  }

  setGroupCollapsed(groupId: number, collapsed: boolean): void {
    const g = this.#groups.get(groupId);
    if (!g) return;
    g.collapsed = collapsed;
    // 折叠时若活动标签正在该组内,把活动态移到组外的标签(港 openclaw)。
    if (collapsed && this.#tabs.find((t) => t.id === this.#activeId)?.groupId === groupId) {
      this.#activeId = this.#tabs.find((t) => t.groupId !== groupId)?.id ?? null;
    }
    this.#emit();
  }

  renameGroup(groupId: number, name: string): void {
    const g = this.#groups.get(groupId);
    if (!g) return;
    g.name = name;
    this.#emit();
  }

  ungroup(groupId: number): void {
    for (const t of this.#tabs) if (t.groupId === groupId) t.groupId = undefined;
    this.#groups.delete(groupId);
    this.#emit();
  }

  closeGroup(groupId: number): boolean {
    this.#tabs = this.#tabs.filter((t) => t.groupId !== groupId);
    this.#groups.delete(groupId);
    if (this.#activeId != null && !this.#tabs.some((t) => t.id === this.#activeId)) {
      this.#activeId = this.#tabs[this.#tabs.length - 1]?.id ?? null;
    }
    this.#emit();
    return this.#tabs.length === 0;
  }

  /** 给某标签弹原生右键菜单用:列出当前其它分组(供"加入分组")。 */
  groups(): TabGroup[] {
    return [...this.#groups.values()];
  }
  groupOf(tabId: number): number | undefined {
    return this.#tabs.find((t) => t.id === tabId)?.groupId;
  }

  #pruneGroup(groupId: number): void {
    if (!this.#tabs.some((t) => t.groupId === groupId)) this.#groups.delete(groupId);
  }

  #emit(): void {
    // 固定标签恒最左、不参与分组;其余拉同组连续。(港 openclaw emitChange 排序)
    const pinned = this.#tabs.filter((t) => t.pinned);
    const rest = this.#tabs.filter((t) => !t.pinned);
    this.#tabs = [...pinned, ...enforceGroupContiguity(rest)];
    this.#onChange();
  }
}
