import type {
  ApiRequest,
  AuthState,
  BaseContext,
  Disposable,
  NetworkState,
  NotifyOptions,
  StorageScope,
  UserInfo,
  WebviewKernel,
} from "@boundary-desktop/contract";
import type { CapabilityHost, ModuleCapabilities } from "./registry.js";
import { StateContainer, type TrackDisposable } from "./state-container.js";
import { ProfileRegistry, wrapDriverView, type WebviewDriver } from "./webview.js";

// ===========================================================================
// 环境驱动 seam —— 基座与具体环境（Electron / 后端 / OS）的接触点。
// 框架只定义最小操作面，真实现由环境注入；headless 默认让基座可独立跑与测。
// ===========================================================================

export interface StorageBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface AuthDriver {
  /** 执行登录流程（OAuth/密码流程），成功后返回 token 与用户信息；基座据此置 auth 状态。 */
  login(): Promise<{ token: string; user: UserInfo }>;
  logout(): Promise<void>;
}

export interface ApiDriver {
  /** 实际发请求。基座注入当前 token（凭证实时供给）；baseURL/刷新/重试归 driver。 */
  request(opts: ApiRequest, token: string | null): Promise<unknown>;
}

export interface NotificationSink {
  show(opts: NotifyOptions): void;
}

export interface Logger {
  write(level: "info" | "warn" | "error", message: string, meta: object): void;
  track(event: string, props: object): void;
}

// --- headless 默认实现 -----------------------------------------------------

class MemoryStorageBackend implements StorageBackend {
  #map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.#map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.#map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.#map.keys()];
  }
}

const throwingAuthDriver: AuthDriver = {
  async login() {
    throw new Error("未配置 AuthDriver：无法发起登录");
  },
  async logout() {},
};

const throwingApiDriver: ApiDriver = {
  async request() {
    throw new Error("未配置 ApiDriver：无法发起请求");
  },
};

const consoleNotificationSink: NotificationSink = {
  show(opts) {
    console[opts.level === "error" ? "error" : "info"](`[notify] ${opts.message}`, opts.detail ?? "");
  },
};

const consoleLogger: Logger = {
  write(level, message, meta) {
    console[level](message, meta);
  },
  track(event, props) {
    console.info(`[track] ${event}`, props);
  },
};

// --- 按模块 id 命名空间隔离的 storage 视图 ---------------------------------

class NamespacedStorage implements StorageScope {
  #backend: StorageBackend;
  #prefix: string;
  constructor(backend: StorageBackend, moduleId: string) {
    this.#backend = backend;
    this.#prefix = `${moduleId}:`;
  }
  async get<T = unknown>(key: string): Promise<T | null> {
    return (await this.#backend.get(this.#prefix + key)) as T | null;
  }
  set<T = unknown>(key: string, value: T): Promise<void> {
    return this.#backend.set(this.#prefix + key, value);
  }
  delete(key: string): Promise<void> {
    return this.#backend.delete(this.#prefix + key);
  }
  async keys(): Promise<string[]> {
    const all = await this.#backend.keys();
    return all
      .filter((k) => k.startsWith(this.#prefix))
      .map((k) => k.slice(this.#prefix.length));
  }
}

// ===========================================================================
// HostServices —— 基座持有的共享状态 + 驱动，按模块产出 ctx 的能力部分。
// ===========================================================================

export interface HostServicesOptions {
  storage?: StorageBackend;
  auth?: AuthDriver;
  api?: ApiDriver;
  notify?: NotificationSink;
  logger?: Logger;
  initialConfig?: Record<string, unknown>;
  initialNetwork?: NetworkState;
  webview?: WebviewDriver;
}

export class HostServices implements CapabilityHost {
  #storage: StorageBackend;
  #authDriver: AuthDriver;
  #apiDriver: ApiDriver;
  #notify: NotificationSink;
  #logger: Logger;

  #authState = new StateContainer<AuthState>({ authenticated: false, user: null });
  #token: string | null = null;
  #config: StateContainer<Record<string, unknown>>;
  #network: StateContainer<NetworkState>;
  #webviewDriver?: WebviewDriver;
  #profiles: ProfileRegistry;

  constructor(opts: HostServicesOptions = {}) {
    this.#storage = opts.storage ?? new MemoryStorageBackend();
    this.#authDriver = opts.auth ?? throwingAuthDriver;
    this.#apiDriver = opts.api ?? throwingApiDriver;
    this.#notify = opts.notify ?? consoleNotificationSink;
    this.#logger = opts.logger ?? consoleLogger;
    this.#config = new StateContainer(opts.initialConfig ?? {});
    this.#network = new StateContainer(opts.initialNetwork ?? { online: true, connected: false });
    this.#webviewDriver = opts.webview;
    this.#profiles = new ProfileRegistry(this.#storage);
  }

  // 基座 / Electron 侧驱动共享状态（模块只读，写在这里）
  updateConfig(config: Record<string, unknown>): void {
    this.#config.set(config);
  }
  updateNetwork(network: NetworkState): void {
    this.#network.set(network);
  }

  // host 级 auth：壳（非模块）经此发起登录/登出、读状态；模块侧 ctx.auth 委托到这同一套实现。
  getToken(): string | null {
    return this.#token;
  }
  getAuthState(): AuthState {
    return this.#authState.get();
  }
  getConfig(): Record<string, unknown> {
    return this.#config.get();
  }
  getNetwork(): NetworkState {
    return this.#network.get();
  }
  subscribeAuth(listener: (state: AuthState) => void): Disposable {
    return this.#authState.subscribe(listener);
  }
  async requestLogin(): Promise<void> {
    const { token, user } = await this.#authDriver.login();
    this.#token = token;
    this.#authState.set({ authenticated: true, user });
  }
  async requestLogout(): Promise<void> {
    await this.#authDriver.logout();
    this.#token = null;
    this.#authState.set({ authenticated: false, user: null });
  }

  forModule(self: BaseContext["self"], track: TrackDisposable): ModuleCapabilities {
    const withSelf = (meta: object | undefined): object => ({
      ...meta,
      module: self.id,
      version: self.version,
    });
    return {
      auth: Object.assign(this.#authState.readonly(track), {
        getToken: () => this.#token,
        requestLogin: () => this.requestLogin(),
        requestLogout: () => this.requestLogout(),
      }),
      config: this.#config.readonly(track),
      network: this.#network.readonly(track),
      api: {
        request: <T = unknown>(opts: ApiRequest): Promise<T> =>
          this.#apiDriver.request(opts, this.#token) as Promise<T>,
      },
      notify: (opts) => this.#notify.show(opts),
      log: {
        info: (msg, meta) => this.#logger.write("info", msg, withSelf(meta)),
        warn: (msg, meta) => this.#logger.write("warn", msg, withSelf(meta)),
        error: (msg, meta) => this.#logger.write("error", msg, withSelf(meta)),
        track: (event, props) => this.#logger.track(event, withSelf(props)),
      },
      storage: new NamespacedStorage(this.#storage, self.id),
      webview: this.#buildWebview(track),
    };
  }

  #buildWebview(track: TrackDisposable): WebviewKernel {
    const driver = this.#webviewDriver;
    return {
      create: async (opts) => {
        if (!driver) throw new Error("未配置 WebviewDriver：无法创建网页 view");
        const view = await driver.create({
          partition: this.#profiles.resolvePartition(opts?.profileId),
          interactive: opts?.interactive ?? true,
          surface: opts?.surface,
        });
        return wrapDriverView(view, track);
      },
      profiles: {
        list: () => this.#profiles.list(),
        create: (name: string) => this.#profiles.create(name),
        remove: (id: string) => this.#profiles.remove(id),
      },
    };
  }
}
