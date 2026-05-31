// 浏览器模块自用的主⇄渲染(chrome 页)IPC 契约。模块内部三处共用(main / preload / 页面类型),
// 不进框架核心契约(框架只给区域;模块对外能力另经 ctx.registerTool 暴露)。

export const CH = {
  // chrome 页 → main(地址栏/按钮触发)
  navigate: "browser-chrome:navigate",
  back: "browser-chrome:back",
  forward: "browser-chrome:forward",
  reload: "browser-chrome:reload",
  // main → chrome 页(当前内容视图的导航态广播)
  state: "browser-chrome:state",
} as const;

/** main 推给 chrome 页的当前内容视图导航态(驱动地址栏与前进/后退可用性、主题)。 */
export interface ChromeState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  theme: "light" | "dark";
}

/** preload 经 contextBridge 暴露给 chrome 页的桥(window.tabAPI)。 */
export interface TabApi {
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  /** 订阅导航态;返回退订函数。 */
  onState(cb: (state: ChromeState) => void): () => void;
}
