import type {
  ApiRequest,
  AuthState,
  Disposable,
  Module,
  NetworkState,
  ReadableState,
  RendererContext,
  ToolHandler,
  WebviewKernel,
} from "@boundary-desktop/contract";
import type { ActivateRequest, SharedState } from "../shared/types";

interface ActiveModule {
  id: string;
  module: Module<RendererContext>;
  handlers: Map<string, ToolHandler>;
  disposables: Disposable[];
}

const EMPTY_SHARED: SharedState = {
  auth: { authenticated: false, user: null },
  token: null,
  config: {},
  network: { online: true, connected: false },
};

/** renderer 模块的 webview 能力存根:IPC bounce 尚未实现,create/profiles 均抛错。
 *  完整实现在后续阶段补齐(需在 ModuleBridge + preload + main ipcHandle 各层各加通道)。 */
const RENDERER_WEBVIEW_STUB: WebviewKernel = {
  create: () => Promise.reject(new Error("renderer webview IPC 尚未实现")),
  profiles: {
    list: () => Promise.reject(new Error("renderer webview IPC 尚未实现")),
    create: () => Promise.reject(new Error("renderer webview IPC 尚未实现")),
    remove: () => Promise.reject(new Error("renderer webview IPC 尚未实现")),
  },
};

/** 渲染进程的模块宿主。主进程经 moduleBridge 下达 activate/deactivate/toolInvoke;
 *  本类 import('app://...') 真模块、构造 RendererContext、跑生命周期,并把模块注册的
 *  tool 暂存在本地以备主进程经 IPC 回调执行。共享状态(auth/config/network)是主进程
 *  权威的本地镜像,使 ctx 的 ReadableState.get() 同步可用。 */
class RendererRuntime {
  #containers = new Map<string, HTMLElement>();
  #active = new Map<number, ActiveModule>();
  #shared: SharedState = EMPTY_SHARED;
  #sharedListeners = new Set<() => void>();
  #navigate: (target: string) => void = () => {};
  #started = false;

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const b = window.moduleBridge;
    b.onActivate((req) => this.#activate(req));
    b.onDeactivate((aid) => this.#deactivate(aid));
    b.onToolInvoke((aid, name, args, caller) => this.#invoke(aid, name, args, caller));
    b.onSharedChanged((s) => {
      this.#shared = s;
      for (const l of [...this.#sharedListeners]) l();
    });
    this.#shared = await b.getShared();
  }

  setContainer(id: string, el: HTMLElement | null): void {
    if (el) this.#containers.set(id, el);
    else this.#containers.delete(id);
  }

  setNavigate(fn: (target: string) => void): void {
    this.#navigate = fn;
  }

  async #activate(req: ActivateRequest): Promise<void> {
    const container = this.#containers.get(req.id);
    if (!container) throw new Error(`模块 ${req.id} 无挂载容器(壳须先 setContainer)`);
    const imported = (await import(/* @vite-ignore */ req.url)) as { default?: Module<RendererContext> };
    const mod = imported.default;
    if (!mod || typeof mod.activate !== "function") {
      throw new Error(`模块 ${req.id} 产物缺合法 default.activate`);
    }
    const active: ActiveModule = { id: req.id, module: mod, handlers: new Map(), disposables: [] };
    await mod.activate(this.#buildCtx(req, container, active));
    this.#active.set(req.aid, active);
  }

  async #deactivate(aid: number): Promise<void> {
    const a = this.#active.get(aid);
    if (!a) return;
    this.#active.delete(aid);
    try {
      await a.module.deactivate?.();
    } finally {
      for (const d of a.disposables) d.dispose();
      const el = this.#containers.get(a.id);
      if (el) el.innerHTML = "";
    }
  }

  async #invoke(aid: number, name: string, args: unknown, caller: string | null): Promise<unknown> {
    const handler = this.#active.get(aid)?.handlers.get(name);
    if (!handler) throw new Error(`模块 aid=${aid} 无 tool ${name}`);
    return handler(args, { caller });
  }

  #readable<T>(get: () => T): ReadableState<T> {
    const listeners = this.#sharedListeners;
    return {
      get,
      subscribe: (listener) => {
        const wrap = (): void => listener(get());
        listeners.add(wrap);
        return { dispose: () => listeners.delete(wrap) };
      },
    };
  }

  #buildCtx(req: ActivateRequest, container: HTMLElement, active: ActiveModule): RendererContext {
    const b = window.moduleBridge;
    const aid = req.aid;
    const track = (d: Disposable): Disposable => {
      active.disposables.push(d);
      return d;
    };
    return {
      self: { id: req.id, version: req.version, runtime: "renderer" },
      auth: Object.assign(this.#readable<AuthState>(() => this.#shared.auth), {
        getToken: () => this.#shared.token,
        requestLogin: () => b.requestLogin(aid),
        requestLogout: () => b.requestLogout(aid),
      }),
      config: this.#readable<Record<string, unknown>>(() => this.#shared.config),
      network: this.#readable<NetworkState>(() => this.#shared.network),
      api: {
        request: <T = unknown>(opts: ApiRequest): Promise<T> => b.apiRequest(aid, opts) as Promise<T>,
      },
      notify: (opts) => {
        void b.notify(aid, opts);
      },
      log: {
        info: (m, meta) => console.info(`[${req.id}] ${m}`, meta ?? ""),
        warn: (m, meta) => console.warn(`[${req.id}] ${m}`, meta ?? ""),
        error: (m, meta) => console.error(`[${req.id}] ${m}`, meta ?? ""),
        track: (e, p) => console.info(`[${req.id}] track ${e}`, p ?? ""),
      },
      invokeTool: <T = unknown>(name: string, args: unknown): Promise<T> =>
        b.invokeTool(aid, name, args) as Promise<T>,
      registerTool: (def) => {
        active.handlers.set(def.name, def.handler);
        void b.registerTool(aid, { name: def.name, schema: def.schema, description: def.description });
        return track({ dispose: () => active.handlers.delete(def.name) });
      },
      on: () => track({ dispose: () => {} }), // MVP:渲染层暂无事件源
      storage: {
        get: <T = unknown>(key: string): Promise<T | null> =>
          b.storage(aid, "get", key) as Promise<T | null>,
        set: <T = unknown>(key: string, value: T): Promise<void> =>
          b.storage(aid, "set", key, value) as Promise<void>,
        delete: (key: string): Promise<void> => b.storage(aid, "delete", key) as Promise<void>,
        keys: (): Promise<string[]> => b.storage(aid, "keys") as Promise<string[]>,
      },
      webview: RENDERER_WEBVIEW_STUB,
      container,
      theme: {
        get: () => "light",
        subscribe: () => ({ dispose: () => {} }), // MVP:主题固定 light
      },
      navigate: (target) => this.#navigate(target),
      registerView: () => track({ dispose: () => {} }), // MVP:导航来自 catalog ui meta
      registerMenuItem: () => track({ dispose: () => {} }),
    };
  }
}

export const runtime = new RendererRuntime();
