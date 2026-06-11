import type {
  ApiRequest,
  AuthState,
  ModuleUiMeta,
  NetworkState,
  NotifyOptions,
  Runtime,
} from "@boundary-desktop/contract";

/** 导航用的模块条目:取自 catalog 的 manifest(激活前即可渲染入口,见 spec 4.2)。 */
export interface ModuleEntry {
  id: string;
  version: string;
  runtime: Runtime;
  ui?: ModuleUiMeta;
  /** host 开机自动激活的常驻模块:其生命周期归 host,渲染端只前台显隐、不再 activate/deactivate。 */
  autostart?: boolean;
}

/** 渲染层共享状态镜像:main 是权威,经 IPC 种子 + 推送同步给 renderer,
 *  使模块 ctx 的 ReadableState.get() 能同步返回快照。 */
export interface SharedState {
  auth: AuthState;
  token: string | null;
  config: Record<string, unknown>;
  network: NetworkState;
}

/** GET /api/auth/profile 的完整个人资料(壳的个人信息页用;非模块契约,不进 contract)。
 *  字段对齐 ai-agent 本地 API 的 LocalProfileResponse。 */
export interface ProfileInfo {
  account_id: string;
  account: string;
  display_name: string;
  role: string;
  tenant_id?: string;
  phone?: string;
  nickname?: string;
  preferences?: string;
}

/** GET /local/status 的聚合状态(壳的系统状态指示用;字段对齐 ai-agent LocalStatusResponse)。
 *  public 端点,无需令牌。worker 端点尚未发现时整体取 null。 */
export interface LocalStatus {
  phase:
    | "starting"
    | "needs_login"
    | "needs_device_activation"
    | "runtime_bootstrapping"
    | "ready"
    | "degraded"
    | "draining"
    | "stopping";
  status: "pending" | "action_required" | "ok" | "degraded" | "error";
  message: string;
  worker: {
    state: "starting" | "ready" | "draining" | "stopping";
    pid: number;
    version: string;
  };
  gateway: {
    state: "disconnected" | "connecting" | "connected" | "reconnecting";
    authenticated: boolean;
    last_error: string | null;
  };
  /** worker 未配置 device manager 时为 null(免设备模式,登录即可达 ready)。 */
  device: {
    state: "not_activated" | "active" | "revoked" | "suspended";
    device_id: string | null;
  } | null;
  runtime: { attached: boolean; configured: boolean; target: string; runtimes: unknown[] };
}

/** 运行状态页要的壳侧信息(非 worker HTTP 提供):app 版本 + 当前 worker spawn 时刻。 */
export interface WorkerInfo {
  /** boundary-desktop 应用版本(app.getVersion())。 */
  desktopVersion: string;
  /** 当前 worker 这一代的 spawn 时刻(ms epoch);尚未 spawn 为 null。供 UPTIME / STARTED。 */
  startedAt: number | null;
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
  /** agentworkerd 运行状态(供 rail 的运行状态页)。 */
  worker: {
    /** 聚合状态(GET /local/status)。worker 端点尚未就绪时为 null。 */
    status(): Promise<LocalStatus | null>;
    /** 壳侧信息:app 版本 + 当前 worker spawn 时刻。 */
    info(): Promise<WorkerInfo>;
    /** 手动重启 worker(优雅停 + 立即重生)。 */
    restart(): Promise<void>;
  };
  auth: {
    getState(): Promise<AuthState>;
    requestLogin(): Promise<void>;
    submitLogin(phone: string, password: string): Promise<{ ok: boolean; error?: string }>;
    requestLogout(): Promise<void>;
    onChange(listener: (state: AuthState) => void): () => void;
    /** 个人信息页:读完整 profile。 */
    getProfile(): Promise<ProfileInfo>;
    /** 个人信息页:改昵称/个性化信息(省略=不变,空串=清空),返回更新后的 profile。 */
    updateProfile(patch: { nickname?: string; preferences?: string }): Promise<ProfileInfo>;
    /** 个人信息页:改登录密码。 */
    changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<{ ok: boolean; error?: string }>;
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
    /** 上报基座级全屏弹层(如系统设置)开合;main 据此强制隐藏/恢复主窗内所有 surface 的 native view。 */
    reportOverlay(active: boolean): Promise<void>;
    /** 订阅某 main 模块 surface 的分离态变化,驱动主窗"已分离"占位卡片显隐。 */
    onDetachedChange(listener: (id: string, detached: boolean) => void): () => void;
    /** 订阅模块的前台请求(如 agent 驱动浏览器导航),壳据此切 activeId 同步高亮。 */
    onForegroundRequest(listener: (id: string) => void): () => void;
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
  onToolInvoke(handler: (aid: number, name: string, args: unknown, caller: string | null) => Promise<unknown>): void;
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
