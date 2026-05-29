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
}

export interface ModuleUiMeta {
  /** 给人看的名字,区别于机器看的 id。有 UI 入口时基本必填。 */
  displayName: string;
  /** 优先:内置图标集里的图标名(安全、风格统一)。
   *  逃生口:内联 SVG 或 data-URI —— 远程内容,渲染前必须 sanitize(防 SVG XSS)。 */
  icon: string;
  description?: string;
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
 *  功能子系统(如浏览器/CDP)以可选命名空间形式挂在这里;
 *  基座未启用对应子系统时为 undefined。MCP/CDP 都属于这一层,不进框架核心。 */
export interface MainContext extends BaseContext {
  readonly self: Readonly<Pick<ModuleManifest, "id" | "version" | "runtime">> & {
    runtime: "main";
  };
  /** 示例功能子系统:浏览器操控。由基座持有页面/CDP 会话,module 经此操作,不持有句柄。 */
  browser?: BrowserSubsystem;
  // 其余功能子系统按需扩展,每个都遵循"基座持有资源、module 经 ctx 操作"。
}

export interface ViewDefinition {
  slot: string; // 宿主预定义的挂载区域
  render(container: HTMLElement): void | Disposable;
}
export interface MenuItemDefinition {
  label: string;
  onClick(): void;
}

/** 功能子系统示例 —— 注意它不是框架核心,只是某类 main module 的扩展能力面。 */
export interface BrowserSubsystem {
  open(url: string): Promise<{ pageId: string }>;
  navigate(pageId: string, url: string): Promise<void>;
  click(pageId: string, selector: string): Promise<void>;
  type(pageId: string, selector: string, text: string): Promise<void>;
  screenshot(pageId: string): Promise<string>; // base64
  close(pageId: string): Promise<void>;
  // 内部通过 webContents.debugger 发 CDP;页面/会话句柄由基座持有,不暴露给 module。
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
