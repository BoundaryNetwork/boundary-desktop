import type { Disposable, ModuleManifest } from "@boundary-desktop/contract";
import type { Registry } from "./registry.js";
import type { ModuleSource } from "./sources.js";

/** 一次对账做了什么。 */
export interface ReconcileReport {
  installed: string[];
  replaced: string[];
  uninstalled: string[];
  unchanged: string[];
}

/** catalog（期望态）↔ Registry（实际态）对账。
 *
 *  catalog 拉来即与当前 live 模块集 diff：新增 install+activate、版本变了 replace、表里没了 uninstall。
 *  首版语义 catalog = 期望激活集，对账后表内模块全部拉到 active。
 *  catalog.version 是触发器：version 未变则跳过（sync 返回 null）。 */
export class Reconciler {
  #source: ModuleSource;
  #registry: Registry;
  #lastVersion: string | undefined;
  #syncing = false;

  constructor(source: ModuleSource, registry: Registry) {
    this.#source = source;
    this.#registry = registry;
  }

  /** 拉 catalog 并对账一次。catalog.version 未变则跳过，返回 null。
   *  单飞：上一轮 sync 未完成时再次触发直接跳过（返回 null），防轮询叠加并发对账。 */
  async sync(): Promise<ReconcileReport | null> {
    if (this.#syncing) return null;
    this.#syncing = true;
    try {
      const catalog = await this.#source.catalog();
      if (catalog.version === this.#lastVersion) return null;
      const report = await this.#reconcile(catalog.modules);
      this.#lastVersion = catalog.version;
      return report;
    } finally {
      this.#syncing = false;
    }
  }

  /** 按间隔轮询 catalog.version 触发 sync。单次 poll 失败不杀轮询（下个 tick 重试）。 */
  start(intervalMs: number, onError?: (err: unknown) => void): Disposable {
    const timer = setInterval(() => {
      void this.sync().catch((err) => onError?.(err));
    }, intervalMs);
    return { dispose: () => clearInterval(timer) };
  }

  async #reconcile(desired: ModuleManifest[]): Promise<ReconcileReport> {
    const report: ReconcileReport = { installed: [], replaced: [], uninstalled: [], unchanged: [] };
    const actual = new Map(this.#registry.modules().map((m) => [m.id, m]));
    const desiredIds = new Set(desired.map((m) => m.id));

    // 表里没了的 → uninstall
    for (const a of actual.values()) {
      if (!desiredIds.has(a.id)) {
        await this.#registry.uninstall(a.id);
        report.uninstalled.push(a.id);
      }
    }

    // 新增 / 版本变了 / 已是最新
    for (const manifest of desired) {
      const cur = actual.get(manifest.id);
      if (!cur || cur.status === "unloaded") {
        await this.#install(manifest);
        report.installed.push(manifest.id);
      } else if (cur.version !== manifest.version) {
        if (cur.status === "active") {
          await this.#registry.replace(manifest.id, manifest);
        } else {
          await this.#registry.uninstall(manifest.id);
          await this.#install(manifest);
        }
        report.replaced.push(manifest.id);
      } else if (cur.status === "active") {
        report.unchanged.push(manifest.id);
      } else if (cur.status === "loaded") {
        // install 成功但 activate 曾失败：重试激活（loaded → active 是合法转移）
        await this.#registry.activate(manifest.id);
        report.installed.push(manifest.id);
      } else {
        // inactive 等非 active 终态：状态机无 inactive→active，只能重装
        await this.#registry.uninstall(manifest.id);
        await this.#install(manifest);
        report.installed.push(manifest.id);
      }
    }

    return report;
  }

  async #install(manifest: ModuleManifest): Promise<void> {
    await this.#registry.install(manifest);
    await this.#registry.activate(manifest.id);
  }
}
