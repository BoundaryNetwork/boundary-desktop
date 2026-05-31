// 浏览器模块自用的主⇄渲染(chrome 页)IPC 契约。模块内部三处共用(main / preload / 页面类型),
// 不进框架核心契约(框架只给区域;模块对外能力另经 ctx.registerTool 暴露)。

export const CH = {
  // chrome 页 → main(地址栏/按钮/标签条触发)
  navigate: "browser-chrome:navigate", // (url)
  back: "browser-chrome:back",
  forward: "browser-chrome:forward",
  reload: "browser-chrome:reload",
  newTab: "browser-chrome:new-tab",
  switchTab: "browser-chrome:switch-tab", // (id)
  closeTab: "browser-chrome:close-tab", // (id)
  ready: "browser-chrome:ready", // 页面订阅就绪后拉一次全量态(避开首帧广播早于监听注册的竞态)
  // main → chrome 页(标签列表 + 活动标签导航态 + 主题)
  state: "browser-chrome:state",
} as const;

/** 单个标签的展示态(分组/固定/profile 留 Phase 5)。 */
export interface TabMeta {
  id: number;
  title: string;
  url: string;
  favicon: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** main 推给 chrome 页的全量态:标签条渲染 + 地址栏/前进后退随活动标签 + 主题。 */
export interface ChromeState {
  tabs: TabMeta[];
  activeTabId: number | null;
  theme: "light" | "dark";
}

/** preload 经 contextBridge 暴露给 chrome 页的桥(window.tabAPI)。 */
export interface TabApi {
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  newTab(): void;
  switchTab(id: number): void;
  closeTab(id: number): void;
  /** 订阅就绪后拉一次当前全量态。 */
  ready(): void;
  /** 订阅全量态;返回退订函数。 */
  onState(cb: (state: ChromeState) => void): () => void;
}
