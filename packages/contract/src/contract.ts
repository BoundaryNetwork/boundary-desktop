/**
 * 基座 ⇄ module 契约抽象
 * --------------------------------------------------------------------------
 * 这是"基座向 module 承诺什么"的类型契约,不含实现。
 * 设计主线:基座持有一切有状态资源,module 只声明 + 写纯逻辑,
 *          能力通过 ctx 注入,生命周期由基座驱动,副作用由基座回收。
 *
 * ctx 能力分三种范式:
 *   1. 共享状态类  基座持有,module 读快照 + 订阅变化(只读)      → ReadableState<T>
 *   2. 代理动作类  敏感/需统一管控的动作,module 请求基座代办      → 返回 Promise 的方法
 *   3. 注册类      module 向系统贡献东西,卸载时按命名空间自动撤掉  → 返回 Disposable
 * 外加一个特例:storage —— module 唯一合法的私有持久状态,按 id 命名空间隔离。
 */

// ===========================================================================
// 0. 基础类型
// ===========================================================================

export type Runtime = "main" | "renderer";

/** 可释放句柄。注册类能力都返回它,但 module 通常无需手动调用 —— 基座已把它
 *  绑定到 module 生命周期,deactivate 时统一回收。dispose() 仅供提前撤销。 */
export interface Disposable {
  dispose(): void;
}

/** 共享状态范式的统一形态:读当前快照 + 订阅后续变化。永远只读。 */
export interface ReadableState<T> {
  /** 读当前快照,用于 activate 时的初始渲染。module 不应缓存它。 */
  get(): T;
  /** 订阅变化,值变即回调。返回句柄绑生命周期,deactivate 自动退订。 */
  subscribe(listener: (value: T) => void): Disposable;
}

// ===========================================================================
// 1. module 自描述(manifest)
// ===========================================================================

export interface ModuleManifest {
  /** 全局唯一。既是身份,也是 tool/view 等注册物的命名空间前缀,由清单服务保证唯一。 */
  id: string;
  version: string;
  /** 决定基座用哪个 Loader 加载、注入哪种 ctx。 */
  runtime: Runtime;
  /** 所需基座能力版本范围(semver)。基座加载前与 HOST_API_VERSION 比对,不满足直接拒绝
   *  → 提示升级客户端。该范围即 module 对 @boundary-desktop/contract 的依赖版本范围。 */
  hostApiVersion: string;
  /** 产物入口(远程 URL)。 */
  entry: string;
  /** 产物完整性 hash。下载后比对,防 CDN 污染/传输损坏。 */
  integrity: string;
  /** 纯展示元信息。框架加载逻辑不读;仅基座渲染 module 入口(激活前)时使用。
   *  无 UI 入口的纯能力 module 可省略。 */
  ui?: ModuleUiMeta;
  /** 置 true 则基座启动后即**后台激活**(不占前台)。用于需常驻、对外暴露 tool 的能力模块
   *  (如浏览器):其 tool 在 MCP/WS 门面里始终可见,无需用户先在 UI 打开该模块。 */
  autostart?: boolean;
}

export interface ModuleUiMeta {
  /** 给人看的名字,区别于机器看的 id。有 UI 入口时基本必填。 */
  displayName: string;
  /** 优先:内置图标集里的图标名(安全、风格统一)。
   *  逃生口:内联 SVG 或 data-URI —— 远程内容,渲染前必须 sanitize(防 SVG XSS)。 */
  icon: string;
  description?: string;
  /** 导航入口排序权重,升序。未指定的排在已指定的之后(按发现顺序)。 */
  order?: number;
}

// ===========================================================================
// 2. module 生命周期契约 —— 所有 runtime 统一的两个钩子
// ===========================================================================

export interface Module<Ctx extends BaseContext = BaseContext> {
  /** 被激活时调用。在此用 ctx 注册副作用(tool/view)、读初始共享状态、挂订阅。 */
  activate(ctx: Ctx): void | Promise<void>;
  /** 撤销 activate 的副作用。理想情况几乎为空 —— 注册类副作用基座已自动回收,
   *  这里只清 module 自己 new 出来的本地东西(定时器等)。
   *
   *  注意:在途任务 drain(替换/卸载前等旧 module 的在途调用清零或明确失败)是
   *  基座私有实现,在调用本钩子之前完成,不经此钩子暴露 —— module 对 drain 无感。 */
  deactivate?(): void | Promise<void>;
}

/** 运行期辅助:身份函数,仅为模块作者提供 Ctx 类型推断与字面量校验。
 *  契约包除此与 HOST_API_VERSION 外不含任何实现。 */
export function defineModule<Ctx extends BaseContext = BaseContext>(
  mod: Module<Ctx>,
): Module<Ctx> {
  return mod;
}

// ===========================================================================
// 3. tool 注册相关类型
// ===========================================================================

/** handler 写法对 runtime 透明:module 当自己在本地被调用即可。
 *  runtime=main 由基座直接调;runtime=renderer 由基座经 IPC 转发到渲染进程执行。 */
export type ToolHandler = (args: unknown) => Promise<unknown>;

export interface ToolDefinition {
  /** 裸名(如 "search")。基座登记时自动加 `<module.id>.` 前缀,module 碰不到前缀。 */
  name: string;
  /** 参数 schema(JSON Schema),供对外门面做 list/校验。 */
  schema: object;
  description?: string;
  handler: ToolHandler;
}

// ===========================================================================
// 4. 共享状态的具体形态
// ===========================================================================

export interface AuthState {
  authenticated: boolean;
  user: UserInfo | null;
}
export interface UserInfo {
  id: string;
  name: string;
  // ...其余用户字段。token 不混在这里,经 auth.getToken() 单独获取。
}

export interface NetworkState {
  online: boolean;
  /** 与后端连接是否健在。 */
  connected: boolean;
}

// ===========================================================================
// 5. BaseContext —— 所有 module(无论 runtime)都拿到的能力
// ===========================================================================

export interface BaseContext {
  /** module 自身只读元信息。 */
  readonly self: Readonly<Pick<ModuleManifest, "id" | "version" | "runtime">>;

  // --- 共享状态类(只读 + 订阅)------------------------------------------
  /** 登录态/用户信息。状态只读;登录/登出走代理动作。
   *  用户信息从 get() 快照同步可得;token 经 getToken() 同步可得。 */
  readonly auth: ReadableState<AuthState> & {
    /** 同步拿当前 token 快照,供 module 自主发请求时带凭证(自有项目,直接给原始 token)。
     *  约定:每次发请求前现取、不长期缓存 —— token 刷新/吊销后下次取到的即最新;登出返回 null。 */
    getToken(): string | null;
    /** 请基座弹出可信登录流程(OAuth/密码流程由基座完成)。 */
    requestLogin(): Promise<void>;
    requestLogout(): Promise<void>;
  };
  /** 全局配置/用户偏好。 */
  readonly config: ReadableState<Record<string, unknown>>;
  /** 网络/连接状态。 */
  readonly network: ReadableState<NetworkState>;

  // --- 代理动作类(请求基座代办)----------------------------------------
  /** 网络请求代发 —— 便利选项,非唯一通道。调自有后端时基座自动加 token/baseURL/刷新/重试,
   *  module 啥都不用管。但 module 也可用 auth.getToken() 自己发请求(第三方 API、流式、
   *  自定义库等),基座不垄断"发请求"这件事,只在凭证供给上保持实时性。 */
  api: {
    request<T = unknown>(opts: ApiRequest): Promise<T>;
  };
  /** 统一通知/提示(基座统一调度与样式,避免多 module 抢着弹)。 */
  notify(opts: NotifyOptions): void;
  /** 统一日志/遥测,基座自动带上 module id/version/用户上下文。 */
  log: {
    info(msg: string, meta?: object): void;
    warn(msg: string, meta?: object): void;
    error(msg: string, meta?: object): void;
    track(event: string, props?: object): void;
  };
  /** 调用任意已注册 tool(含别的 module 的)。module 间通信收口到基座路由,不互相直连。 */
  invokeTool<T = unknown>(name: string, args: unknown): Promise<T>;

  // --- 注册类(返回句柄,生命周期自动回收)-------------------------------
  /** 注册 tool。自动加命名空间 + 注册时查重(同 module 内重名直接抛错)。 */
  registerTool(def: ToolDefinition): Disposable;
  /** 订阅系统离散事件(某 tool 被调、某资源变化等)。 */
  on(event: string, listener: (payload: unknown) => void): Disposable;

  // --- 私有持久(命名空间隔离)------------------------------------------
  /** module 唯一合法的持有状态途径:数据落在基座管理的存储里,按 id 隔离。
   *  热替换后新版本用同一命名空间读回 —— 这是"状态外置"的正面用法。
   *  注意:敏感数据(凭证等)不放这里,它们属于 auth、由基座持有。 */
  storage: StorageScope;
  /** 通用「原生网页渲染 + 驱动」能力(WebView Kernel)。所有 runtime 可用,用不用随你;
   *  renderer 模块经 IPC bounce 到主进程。无窗口的 headless 环境下 create 抛错、profiles 仍可用。 */
  readonly webview: WebviewKernel;
}

export interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>; // 走 api.request 时 Authorization 由基座加;自主发请求则用 auth.getToken()
}

export interface NotifyOptions {
  level: "info" | "success" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface StorageScope {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// ===========================================================================
// 6. 按 runtime 裁剪的扩展 ctx(单一维度:只看 runtime)
// ===========================================================================

/** 渲染层 UI module 额外拿到的能力。 */
export interface RendererContext extends BaseContext {
  readonly self: Readonly<Pick<ModuleManifest, "id" | "version" | "runtime">> & {
    runtime: "renderer";
  };
  /** 基座分配的挂载容器。 */
  readonly container: HTMLElement;
  /** 主题/外观,渲染层跟随它重渲染。 */
  readonly theme: ReadableState<"light" | "dark">;
  /** 请宿主跳转/打开视图。 */
  navigate(target: string, params?: object): void;
  /** 向宿主区域贡献界面(面板/菜单项/设置页 tab),按命名空间自动撤销。 */
  registerView(def: ViewDefinition): Disposable;
  registerMenuItem(def: MenuItemDefinition): Disposable;
}

/** 主进程能力 module 额外拿到的能力。
 *  main-runtime 模块自己持有功能子系统(view/CDP/automation),对外能力只经
 *  `ctx.registerTool` 暴露;框架不为任何具体功能域加能力面。需要原生 UI 的
 *  main 模块经下面通用的 `surface` 拿一块区域,框架不含功能语义。 */
export interface MainContext extends BaseContext {
  readonly self: Readonly<Pick<ModuleManifest, "id" | "version" | "runtime">> & {
    runtime: "main";
  };
  /** 框架分配的 UI 区域;无 UI 的纯能力 main 模块为 undefined。 */
  readonly surface?: ModuleSurface;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 框架分配给 main 模块的 UI 区域(本项目左右布局里的右侧 content 区;可分离为独立窗口)。
 *  通用能力,非浏览器专属:任何需要原生 UI 的 main 模块都可用,框架不含功能语义。 */
export interface ModuleSurface {
  /** 区域在宿主窗口内容区的矩形(DIP,非屏幕坐标),随 resize / 布局 / detach 变化更新。 */
  readonly bounds: ReadableState<Rect>;
  /** 模块是否当前可见(前台)。非可见时模块应隐藏其 view,但仍保活、不销毁资源。 */
  readonly visible: ReadableState<boolean>;
  /** 主题,模块 chrome 跟随。 */
  readonly theme: ReadableState<"light" | "dark">;
  /** 当前是否已分离为独立窗口。 */
  readonly detached: ReadableState<boolean>;
  /** 把模块创建的 native view 挂到本区域;返回句柄,deactivate 自动摘除。
   *  view 为不透明句柄(契约不耦合 Electron 类型);main 模块在主进程自行创建。
   *  detach/merge 时框架把已 attach 的 view 整体 re-parent,模块无感。 */
  attach(view: object): Disposable;
  /** 请求把本 surface 分离到独立窗口(由框架建窗、re-parent;窗口仍归框架)。 */
  detach(): Promise<void>;
  /** 合并回主窗口。 */
  merge(): Promise<void>;
  /** 请求把本区域提到前台(变可见)。用于模块响应外部事件(如 agent 经 tool 驱动浏览器导航)
   *  时把自己的 UI 浮出来给用户看;框架据此切前台并同步导航高亮。 */
  requestForeground(): void;
}

export interface ViewDefinition {
  slot: string; // 宿主预定义的挂载区域
  render(container: HTMLElement): void | Disposable;
}
export interface MenuItemDefinition {
  label: string;
  onClick(): void;
}

// ===========================================================================
// 6.1 WebView Kernel —— 通用宿主能力(原生网页渲染 + 驱动)。语义上不绑浏览器业务
// (tab/书签/地址栏那类),任何要在区域内渲染并驱动网页的模块都可用;实现基于 Chromium
// WebContentsView,故底层逃生口(cdp)是 Chromium 专属——见 WebviewHandle.cdp 注释。
// ===========================================================================

/** 一个浏览器账号:一套隔离的 cookie/storage 分区。注册表由基座持有(共享登录态)。 */
export interface WebviewProfile {
  id: string;
  name: string;
}

export type WebviewEvent = "did-navigate" | "title-updated" | "loading" | "favicon-updated";

/** 页面节点的不透明引用(driver 内部映射到 CDP backendNodeId 等);消费方只原样传回。 */
export interface ElementRef {
  readonly token: string;
}

export interface ScrollOptions {
  /** 滚动目标(元素引用或选择器);省略则滚动整页。 */
  target?: ElementRef | string;
  /** 水平增量偏移,CSS 像素;正右负左。 */
  dx?: number;
  /** 垂直增量偏移,CSS 像素;正下负上。 */
  dy?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
}

/** 一块原生网页 view 的句柄。注册类:基座把它绑到激活生命周期,deactivate 自动销毁。
 *  对 renderer 模块所有方法经 IPC bounce 到主进程;对 main 模块主进程内直调。 */
export interface WebviewHandle extends Disposable {
  navigate(url: string): Promise<void>;
  /** 区域矩形(DIP,相对宿主窗口 content 区);消费方喂(main 派生 surface.bounds,renderer 测 DOM)。 */
  setBounds(rect: Rect): void;
  /** 模块内部显隐意图;最终可见性 = 模块前台 AND 本值(前台态框架自动叠加)。 */
  setVisible(visible: boolean): void;
  /** false=锁定:框架在 native 层盖透明 backdrop 拦人鼠标键盘;程序通道(下列)不受影响。 */
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;

  // --- 单步原语(下沉的 AutomationEngine)-------------------------------------
  find(selector: string): Promise<ElementRef | null>;
  click(target: ElementRef | string): Promise<void>;
  type(target: ElementRef | string, text: string): Promise<void>;
  upload(target: ElementRef | string, paths: string[]): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
  eval<T = unknown>(expression: string): Promise<T>;

  /** 原始 CDP(Chromium DevTools Protocol)通道。内核基于 Chromium WebContentsView,
   *  这是其底层驱动逃生口——单步原语满足不了时直接发 CDP;按定义即 Chromium 专属,不保证可移植。
   *  每个 view 一条独立会话,消费方互不干扰。 */
  readonly cdp: {
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, listener: (payload: unknown) => void): Disposable;
  };
}

/** 创建一块网页 view 的选项:选 profile 分区、是否可交互、是否绑定到某 surface(随其 detach)。 */
export interface WebviewCreateOptions {
  /** 用哪个 profile 的分区;省略走 default。 */
  profileId?: string;
  /** 是否允许人操作;默认 true。false 由框架盖 backdrop 锁定。 */
  interactive?: boolean;
  /** 可选绑定一个 surface:view 跟随该 surface(detach 时框架整体 re-parent)。
   *  main 模块传自己的 ctx.surface;renderer 模块不传(view 挂主窗 content 区)。 */
  surface?: ModuleSurface;
}

/** 框架分配的通用「原生网页渲染 + 驱动」能力(WebView Kernel)。任何 runtime 的模块都可用。 */
export interface WebviewKernel {
  create(opts?: WebviewCreateOptions): Promise<WebviewHandle>;
  /** profile 注册表(共享登录态)。 */
  readonly profiles: {
    list(): Promise<WebviewProfile[]>;
    create(name: string): Promise<WebviewProfile>;
    remove(id: string): Promise<void>;
  };
}

// ===========================================================================
// 7. 基座内部接口(Loader / Registry)—— module 看不到,列出以示完整
// ===========================================================================

/** 加载器适配器:把"代码在某 runtime 下变成 Module 实例"的脏活收口。
 *  新增隔离级别(如进程级 webview)= 新增一个 Loader,上层与 module 契约都不动。 */
export interface ModuleLoader {
  canLoad(manifest: ModuleManifest): boolean;
  load(localPath: string, manifest: ModuleManifest): Promise<Module>;
}

export type ModuleStatus =
  | "discovered" | "resolved" | "fetched"
  | "loaded" | "active" | "inactive" | "unloaded";

/** 注册表 + 生命周期状态机驱动者。基座的核心。 */
export interface ModuleRegistry {
  install(manifest: ModuleManifest): Promise<void>;          // discovered → loaded
  activate(id: string): Promise<void>;                       // loaded → active
  /** active → inactive。基座在此先 drain 在途任务(等清零或明确失败),再调 module.deactivate。 */
  deactivate(id: string): Promise<void>;
  /** 热替换:新版本先 activate,旧版本再 deactivate(先起后落)。 */
  replace(id: string, manifest: ModuleManifest): Promise<void>;
  uninstall(id: string): Promise<void>;
  status(id: string): ModuleStatus;
}
