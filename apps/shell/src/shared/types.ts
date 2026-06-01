import type {
  ApiRequest,
  AuthState,
  ModuleUiMeta,
  NetworkState,
  NotifyOptions,
} from "@boundary-desktop/contract";

/** 导航用的模块条目:取自 catalog 的 manifest(激活前即可渲染入口,见 spec 4.2)。 */
export interface ModuleEntry {
  id: string;
  version: string;
  ui?: ModuleUiMeta;
}

/** 渲染层共享状态镜像:main 是权威,经 IPC 种子 + 推送同步给 renderer,
 *  使模块 ctx 的 ReadableState.get() 能同步返回快照。 */
export interface SharedState {
  auth: AuthState;
  token: string | null;
  config: Record<string, unknown>;
  network: NetworkState;
}

/** main 让 renderer runtime 激活某模块的指令。 */
export interface ActivateRequest {
  aid: number;
  id: string;
  version: string;
  url: string;
}

/** 壳通过 preload contextBridge 拿到的受控 host API。main 实现、壳消费。 */
export interface HostApi {
  /** 宿主平台(darwin/win32/linux),壳据此处理 macOS 标题栏 strip。 */
  platform: string;
  /** 当前运行环境(local/staging/prod),壳据此显示角标、区分多环境。 */
  env(): Promise<string>;
  auth: {
    getState(): Promise<AuthState>;
    requestLogin(): Promise<void>;
    submitLogin(phone: string, password: string): Promise<{ ok: boolean; error?: string }>;
    requestLogout(): Promise<void>;
    onChange(listener: (state: AuthState) => void): () => void;
  };
  modules: {
    list(): Promise<ModuleEntry[]>;
    activate(id: string): Promise<void>;
    deactivate(id: string): Promise<void>;
  };
  /** 壳把 renderer 才知道的状态(前台模块、主题)上报给 main，驱动 main 模块的 surface。 */
  surface: {
    reportForeground(id: string | null): Promise<void>;
    reportTheme(theme: "light" | "dark"): Promise<void>;
    /** 把分离到独立窗的 main 模块合并回主窗(占位卡片按钮调用)。 */
    merge(id: string): Promise<void>;
    /** 订阅某 main 模块 surface 的分离态变化,驱动主窗"已分离"占位卡片显隐。 */
    onDetachedChange(listener: (id: string, detached: boolean) => void): () => void;
  };
  /** 无边框窗口的自绘红绿灯:把系统三连键语义经 IPC 暴露给壳(仅 macOS 用)。 */
  window: {
    minimize(): Promise<void>;
    close(): Promise<void>;
    toggleMaximize(): Promise<void>;
    toggleFullscreen(): Promise<void>;
    isFocused(): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    onFocusChange(listener: (focused: boolean) => void): () => void;
    onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
  };
}

/** renderer runtime(模块宿主)通过 preload 拿到的桥。负责跨进程模块生命周期与 ctx 能力。 */
export interface ModuleBridge {
  // main → runtime
  onActivate(handler: (req: ActivateRequest) => Promise<void>): void;
  onDeactivate(handler: (aid: number) => Promise<void>): void;
  onToolInvoke(handler: (aid: number, name: string, args: unknown) => Promise<unknown>): void;
  onSharedChanged(listener: (shared: SharedState) => void): void;
  // runtime → main(都带 aid,主进程按 aid 取对应模块的 main 侧 ctx 来执行)
  getShared(): Promise<SharedState>;
  registerTool(aid: number, def: { name: string; schema: object; description?: string }): Promise<void>;
  invokeTool(aid: number, name: string, args: unknown): Promise<unknown>;
  notify(aid: number, opts: NotifyOptions): Promise<void>;
  apiRequest(aid: number, opts: ApiRequest): Promise<unknown>;
  storage(
    aid: number,
    op: "get" | "set" | "delete" | "keys",
    key?: string,
    value?: unknown,
  ): Promise<unknown>;
  requestLogin(aid: number): Promise<void>;
  requestLogout(aid: number): Promise<void>;
}

declare global {
  interface Window {
    hostApi: HostApi;
    moduleBridge: ModuleBridge;
  }
}
