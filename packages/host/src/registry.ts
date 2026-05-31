import type {
  BaseContext,
  Disposable,
  Module,
  ModuleLoader,
  ModuleManifest,
  ModuleRegistry as IModuleRegistry,
  ModuleStatus,
  ModuleSurface,
} from "@boundary-desktop/contract";
import { HOST_API_VERSION } from "@boundary-desktop/contract";
import semver from "semver";
import { DrainLedger } from "./drain-ledger.js";
import type { ToolFacade } from "./facade.js";
import { Mutex } from "./mutex.js";
import type { TrackDisposable } from "./state-container.js";
import { ToolRegistry, type ToolInfo } from "./tool-registry.js";

/** Registry 加载所需的最小来源能力：给定 manifest，拿到一个本地产物路径。
 *  catalog 发现属于上层（见 sources.ts 的 ModuleSource / reconcile.ts），Registry 不感知。 */
export interface ArtifactSource {
  fetchArtifact(manifest: ModuleManifest): Promise<string>;
}

/** 已登记模块的对外快照，供对账引擎 diff 期望态用。 */
export interface ModuleSnapshot {
  id: string;
  version: string;
  status: ModuleStatus;
}

/** ctx 中非生命周期的能力部分（共享状态 / 代理动作 / storage）。
 *  phase 2 注入假实现；phase 3 由基座实现真的。生命周期相关的
 *  self / registerTool / invokeTool / on 由 Registry 自己接，不在此。 */
export type ModuleCapabilities = Omit<
  BaseContext,
  "self" | "registerTool" | "invokeTool" | "on"
>;

export interface CapabilityHost {
  /** 产出 ctx 的能力部分。track 把能力发出的订阅绑到本次激活，随 deactivate 自动回收。 */
  forModule(self: BaseContext["self"], track: TrackDisposable): ModuleCapabilities;
}

/** 为 main-runtime 模块提供 UI 区域（MainContext.surface）的环境 seam。
 *  持有窗口的环境（apps/shell）注入实现；headless / 无 UI 环境不注入 → ctx.surface 为
 *  undefined（契约允许）。这是通用能力面，框架不含任何功能域语义。 */
export interface SurfaceProvider {
  /** 为本次激活产出一个 surface。track 把 surface 的副作用（view 容器等）绑到激活生命周期，
   *  deactivate 时自动回收。返回 undefined = 该模块不分配区域（如无 ui 入口的纯能力 main 模块）。 */
  provide(self: BaseContext["self"], track: TrackDisposable): ModuleSurface | undefined;
}

export interface RegistryOptions {
  source: ArtifactSource;
  loaders: ModuleLoader[];
  capabilityHost: CapabilityHost;
  /** main-runtime 模块的 UI 区域提供者。持窗口的环境注入；不注入则 main 模块 ctx.surface 为 undefined。 */
  surfaceProvider?: SurfaceProvider;
  /** 基座实现的契约版本，用于和模块 manifest 的 hostApiVersion 比对。默认取契约包常量。 */
  hostApiVersion?: string;
  /** deactivate/replace 前等在途调用清零的上限，超时则该操作失败。默认 30s。 */
  drainTimeoutMs?: number;
}

interface Activation {
  token: number;
  disposables: Disposable[];
}

interface ModuleRecord {
  manifest: ModuleManifest;
  status: ModuleStatus;
  instance: Module;
  activation?: Activation;
}

/** 注册表 + 生命周期状态机驱动者。基座的核心。
 *  install/activate/deactivate/replace/uninstall 全部经 mutex 串行，状态机无并发撕裂。 */
export class Registry implements IModuleRegistry {
  #source: ArtifactSource;
  #loaders: ModuleLoader[];
  #capabilityHost: CapabilityHost;
  #surfaceProvider?: SurfaceProvider;
  #hostApiVersion: string;
  #drainTimeoutMs: number;

  #ledger = new DrainLedger();
  #tools: ToolRegistry;
  #mutex = new Mutex();
  #records = new Map<string, ModuleRecord>();
  /** 已登记但尚无事件源消费的订阅（phase 2 无事件源；订阅照样登记 + 随 deactivate 回收）。 */
  #subscriptions = new Map<string, Set<(payload: unknown) => void>>();
  #nextToken = 1;
  /** tool 集合变更计数（对账依据）+ 变更监听者（门面主动推送的来源）。 */
  #toolsVersion = 0;
  #toolsListeners = new Set<() => void>();

  constructor(opts: RegistryOptions) {
    this.#source = opts.source;
    this.#loaders = opts.loaders;
    this.#capabilityHost = opts.capabilityHost;
    this.#surfaceProvider = opts.surfaceProvider;
    this.#hostApiVersion = opts.hostApiVersion ?? HOST_API_VERSION;
    this.#drainTimeoutMs = opts.drainTimeoutMs ?? 30_000;
    this.#tools = new ToolRegistry(this.#ledger, () => this.#bumpTools());
  }

  // --- 契约：生命周期状态机 -------------------------------------------------

  install(manifest: ModuleManifest): Promise<void> {
    return this.#mutex.run(async () => {
      const existing = this.#records.get(manifest.id);
      if (existing) {
        // 表里有记录即视为已安装：uninstall 是直接 delete，不会留 unloaded 态记录
        throw new Error(`模块 ${manifest.id} 已安装（status=${existing.status}）`);
      }
      const instance = await this.#load(manifest);
      this.#records.set(manifest.id, { manifest, status: "loaded", instance });
    });
  }

  activate(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const rec = this.#requireStatus(id, "loaded");
      rec.activation = await this.#activate(rec);
      rec.status = "active";
    });
  }

  deactivate(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const rec = this.#requireStatus(id, "active");
      await this.#deactivate(rec);
      rec.status = "inactive";
    });
  }

  /** 热替换：先起后落。新版本独立加载并激活（栈顶即时切到新逻辑），旧版本再 drain + 退场。
   *  任一步失败都原子回滚到"旧版本仍在服务"，绝不留半截状态。 */
  replace(id: string, manifest: ModuleManifest): Promise<void> {
    return this.#mutex.run(async () => {
      const rec = this.#requireStatus(id, "active");
      if (manifest.id !== id) {
        throw new Error(`replace 的 manifest.id（${manifest.id}）与目标 ${id} 不一致`);
      }
      const old = rec.activation!;
      const oldInstance = rec.instance;

      // 先起：新版本走完加载 + 激活，其 tool 压栈成栈顶；失败由 #activate 自行回收并抛出，旧版本未动。
      const newInstance = await this.#load(manifest);
      const newRec: ModuleRecord = { manifest, status: "loaded", instance: newInstance };
      newRec.activation = await this.#activate(newRec);

      // 后落：drain 旧代在途调用。超时则回滚新版本，旧版本继续服务，replace 整体失败。
      try {
        await this.#ledger.drain(old.token, this.#drainTimeoutMs);
      } catch (err) {
        await this.#safeDeactivate(newInstance);
        for (const d of newRec.activation.disposables) d.dispose();
        throw err;
      }
      await this.#safeDeactivate(oldInstance);
      for (const d of old.disposables) d.dispose();

      newRec.status = "active";
      this.#records.set(id, newRec);
    });
  }

  uninstall(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const rec = this.#records.get(id);
      if (!rec) throw new Error(`模块 ${id} 未安装`);
      if (rec.status === "active") await this.#deactivate(rec);
      this.#records.delete(id);
    });
  }

  status(id: string): ModuleStatus {
    return this.#records.get(id)?.status ?? "unloaded";
  }

  /** 当前已登记模块的快照，供对账引擎 diff。 */
  modules(): ModuleSnapshot[] {
    return [...this.#records.values()].map((r) => ({
      id: r.manifest.id,
      version: r.manifest.version,
      status: r.status,
    }));
  }

  // --- 对外门面三件套 -------------------------------------------------------

  listTools(): ToolInfo[] {
    return this.#tools.list();
  }

  invokeTool(name: string, args: unknown): Promise<unknown> {
    return this.#tools.invoke(name, args);
  }

  /** tool 集合的变更计数，断线重连后对账用。 */
  version(): number {
    return this.#toolsVersion;
  }

  /** 订阅 tool 集合变更（注册/卸载/热替换触发），供门面主动推送。 */
  onChange(listener: () => void): Disposable {
    this.#toolsListeners.add(listener);
    return {
      dispose: () => {
        this.#toolsListeners.delete(listener);
      },
    };
  }

  /** 取一个绑定到本 Registry 的三件套门面句柄，交给具体门面（WS/MCP/CLI）消费。 */
  facade(): ToolFacade {
    return {
      list: () => this.listTools(),
      invoke: (name, args) => this.invokeTool(name, args),
      version: () => this.version(),
      onChange: (listener) => this.onChange(listener),
    };
  }

  #bumpTools(): void {
    this.#toolsVersion++;
    for (const listener of [...this.#toolsListeners]) listener();
  }

  // --- 内部 -----------------------------------------------------------------

  /** Discovered/Resolved/Fetched/Loaded：版本闸门 → 取产物 → Loader 加载成实例。 */
  async #load(manifest: ModuleManifest): Promise<Module> {
    if (!semver.satisfies(this.#hostApiVersion, manifest.hostApiVersion, { includePrerelease: true })) {
      throw new Error(
        `模块 ${manifest.id} 需要 hostApiVersion ${manifest.hostApiVersion}，` +
          `当前基座 ${this.#hostApiVersion}，请升级客户端`,
      );
    }
    const path = await this.#source.fetchArtifact(manifest);
    const loader = this.#loaders.find((l) => l.canLoad(manifest));
    if (!loader) {
      throw new Error(`无 Loader 可加载 runtime=${manifest.runtime} 的模块 ${manifest.id}`);
    }
    return loader.load(path, manifest);
  }

  /** 分配代际 token、建 ctx、跑 activate。失败则回收本次已注册的副作用并抛出（不留半截）。 */
  async #activate(rec: ModuleRecord): Promise<Activation> {
    const token = this.#nextToken++;
    const disposables: Disposable[] = [];
    const ctx = this.#buildCtx(rec.manifest, token, disposables);
    try {
      await rec.instance.activate(ctx);
    } catch (err) {
      for (const d of disposables) d.dispose();
      throw err;
    }
    return { token, disposables };
  }

  /** drain 在途 → module.deactivate → 回收副作用。drain 超时会抛出，调用方据此让操作失败。 */
  async #deactivate(rec: ModuleRecord): Promise<void> {
    const act = rec.activation!;
    await this.#ledger.drain(act.token, this.#drainTimeoutMs);
    await this.#safeDeactivate(rec.instance);
    for (const d of act.disposables) d.dispose();
    rec.activation = undefined;
  }

  /** 调 module.deactivate 清本地副作用。best-effort：模块抛错只记日志，绝不撕裂状态机
   *  ——tool 回收、记录更新等后续步骤必须照常执行。 */
  async #safeDeactivate(instance: Module): Promise<void> {
    try {
      await instance.deactivate?.();
    } catch (err) {
      console.error("[registry] module.deactivate 抛错（已忽略，继续回收）", err);
    }
  }

  #buildCtx(manifest: ModuleManifest, token: number, disposables: Disposable[]): BaseContext {
    const self = Object.freeze({
      id: manifest.id,
      version: manifest.version,
      runtime: manifest.runtime,
    });
    const track: TrackDisposable = (disposable) => {
      disposables.push(disposable);
      return disposable;
    };
    const capabilities = this.#capabilityHost.forModule(self, track);
    const ctx: BaseContext = {
      self,
      ...capabilities,
      registerTool: (def) =>
        track(this.#tools.register(token, manifest.id, manifest.runtime, def)),
      invokeTool: <T = unknown>(name: string, args: unknown): Promise<T> =>
        this.#tools.invoke(name, args) as Promise<T>,
      on: (event, listener) => {
        const set = this.#subscriptions.get(event) ?? new Set();
        set.add(listener);
        this.#subscriptions.set(event, set);
        return track({
          dispose: () => {
            set.delete(listener);
            if (set.size === 0) this.#subscriptions.delete(event);
          },
        });
      },
    };
    // main-runtime 模块按 runtime 单维度多拿一个 UI 区域（MainContext.surface）。
    // 由环境注入的 provider 产出；headless 无 provider → 不挂 surface（契约允许 undefined）。
    if (manifest.runtime === "main") {
      const surface = this.#surfaceProvider?.provide(self, track);
      if (surface) Object.assign(ctx, { surface });
    }
    return ctx;
  }

  #requireStatus(id: string, expected: ModuleStatus): ModuleRecord {
    const rec = this.#records.get(id);
    if (!rec) throw new Error(`模块 ${id} 未安装`);
    if (rec.status !== expected) {
      throw new Error(`模块 ${id} 状态为 ${rec.status}，需 ${expected}`);
    }
    return rec;
  }
}
