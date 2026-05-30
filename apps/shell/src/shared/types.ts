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
