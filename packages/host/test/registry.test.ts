import { describe, expect, test, vi } from "vitest";
import {
  defineModule,
  type AuthState,
  type MainContext,
  type Module,
  type ModuleLoader,
  type ModuleManifest,
  type ModuleSurface,
  type NetworkState,
  type ReadableState,
} from "@boundary-desktop/contract";
import {
  Registry,
  type ArtifactSource,
  type CapabilityHost,
  type SurfaceProvider,
} from "../src/index.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function manifest(id: string, version = "1.0.0", hostApiVersion = "*"): ModuleManifest {
  return { id, version, runtime: "main", hostApiVersion, entry: "x", integrity: "x" };
}

const readable = <T>(value: T): ReadableState<T> => ({
  get: () => value,
  subscribe: () => ({ dispose() {} }),
});

/** phase 2 假能力：测试模块只用 registerTool/invokeTool，这些字段不被断言。 */
const fakeCapabilityHost: CapabilityHost = {
  forModule: () => ({
    auth: Object.assign(readable<AuthState>({ authenticated: false, user: null }), {
      getToken: () => null,
      requestLogin: async () => {},
      requestLogout: async () => {},
    }),
    config: readable<Record<string, unknown>>({}),
    network: readable<NetworkState>({ online: true, connected: true }),
    api: {
      request: async () => {
        throw new Error("phase2: api 未实现");
      },
    },
    notify: () => {},
    log: { info() {}, warn() {}, error() {}, track() {} },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
    },
  }),
};

/** 内存来源 + 内存 Loader：按 `${id}@${version}` 取出测试模块，不碰文件系统。 */
class Harness {
  #modules = new Map<string, Module>();
  registry: Registry;

  constructor(opts: { drainTimeoutMs?: number; surfaceProvider?: SurfaceProvider } = {}) {
    const source: ArtifactSource = {
      fetchArtifact: async (m) => `memory://${m.id}@${m.version}`,
    };
    const loader: ModuleLoader = {
      canLoad: () => true,
      load: async (_path, m) => {
        const mod = this.#modules.get(`${m.id}@${m.version}`);
        if (!mod) throw new Error(`test: 未提供模块 ${m.id}@${m.version}`);
        return mod;
      },
    };
    this.registry = new Registry({
      source,
      loaders: [loader],
      capabilityHost: fakeCapabilityHost,
      surfaceProvider: opts.surfaceProvider,
      drainTimeoutMs: opts.drainTimeoutMs,
    });
  }

  set(id: string, version: string, mod: Module): void {
    this.#modules.set(`${id}@${version}`, mod);
  }
}

describe("命名空间与调用", () => {
  test("activate 注册带 <id>. 前缀的 tool 并可调用", async () => {
    const h = new Harness();
    h.set(
      "calc",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({
            name: "add",
            schema: {},
            handler: async (a) => (a as { x: number }).x + 1,
          });
        },
      }),
    );
    await h.registry.install(manifest("calc"));
    await h.registry.activate("calc");

    expect(h.registry.status("calc")).toBe("active");
    expect(h.registry.listTools().map((t) => t.name)).toEqual(["calc.add"]);
    expect(await h.registry.invokeTool("calc.add", { x: 41 })).toBe(42);
  });

  test("跨模块同裸名结构性不冲突", async () => {
    const h = new Harness();
    const mk = (id: string) =>
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "search", schema: {}, handler: async () => id });
        },
      });
    h.set("a", "1.0.0", mk("a"));
    h.set("b", "1.0.0", mk("b"));
    await h.registry.install(manifest("a"));
    await h.registry.activate("a");
    await h.registry.install(manifest("b"));
    await h.registry.activate("b");

    expect(h.registry.listTools().map((t) => t.name).sort()).toEqual(["a.search", "b.search"]);
    expect(await h.registry.invokeTool("a.search", {})).toBe("a");
    expect(await h.registry.invokeTool("b.search", {})).toBe("b");
  });

  test("模块内重名 → 激活失败且不留残留", async () => {
    const h = new Harness();
    h.set(
      "dup",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "x", schema: {}, handler: async () => 1 });
          ctx.registerTool({ name: "x", schema: {}, handler: async () => 2 });
        },
      }),
    );
    await h.registry.install(manifest("dup"));
    await expect(h.registry.activate("dup")).rejects.toThrow(/重复注册/);

    expect(h.registry.status("dup")).toBe("loaded");
    expect(h.registry.listTools()).toEqual([]);
  });
});

describe("生命周期回收", () => {
  test("deactivate 回收该模块所有 tool", async () => {
    const h = new Harness();
    h.set(
      "m",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "t", schema: {}, handler: async () => 1 });
        },
      }),
    );
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");
    expect(h.registry.listTools().length).toBe(1);

    await h.registry.deactivate("m");
    expect(h.registry.status("m")).toBe("inactive");
    expect(h.registry.listTools()).toEqual([]);
  });

  test("uninstall active 模块 → drain + deactivate 后 unloaded", async () => {
    const h = new Harness();
    const deact = vi.fn();
    h.set(
      "m",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "t", schema: {}, handler: async () => 1 });
        },
        deactivate: deact,
      }),
    );
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");
    await h.registry.uninstall("m");

    expect(deact).toHaveBeenCalledOnce();
    expect(h.registry.status("m")).toBe("unloaded");
    expect(h.registry.listTools()).toEqual([]);
  });

  test("module.deactivate 抛错不撕裂状态机：仍回收 tool 并进 inactive", async () => {
    const h = new Harness();
    h.set(
      "m",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "t", schema: {}, handler: async () => 1 });
        },
        deactivate() {
          throw new Error("deactivate boom");
        },
      }),
    );
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(h.registry.deactivate("m")).resolves.toBeUndefined(); // 模块抛错不让操作失败
    expect(h.registry.status("m")).toBe("inactive"); // 状态照常推进
    expect(h.registry.listTools()).toEqual([]); // tool 照常回收
    expect(errSpy).toHaveBeenCalled(); // 抛错被记录而非冒泡
    errSpy.mockRestore();
  });
});

describe("在途任务 drain", () => {
  test("deactivate 等在途调用清零再完成", async () => {
    const h = new Harness();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.set(
      "slow",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({
            name: "wait",
            schema: {},
            handler: async () => {
              await gate;
              return "done";
            },
          });
        },
      }),
    );
    await h.registry.install(manifest("slow"));
    await h.registry.activate("slow");

    const inv = h.registry.invokeTool("slow.wait", {}); // 在途：ledger.enter 已同步执行
    const deact = h.registry.deactivate("slow");
    let deactDone = false;
    void deact.then(() => {
      deactDone = true;
    });

    await delay(20);
    expect(deactDone).toBe(false); // drain 仍在等

    release();
    expect(await inv).toBe("done");
    await deact;
    expect(deactDone).toBe(true);
    expect(h.registry.status("slow")).toBe("inactive");
  });

  test("drain 超时 → deactivate 失败，模块保持 active", async () => {
    const h = new Harness({ drainTimeoutMs: 30 });
    const gate = new Promise<void>(() => {}); // 永不 resolve
    h.set(
      "stuck",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({
            name: "hang",
            schema: {},
            handler: async () => {
              await gate;
              return 1;
            },
          });
        },
      }),
    );
    await h.registry.install(manifest("stuck"));
    await h.registry.activate("stuck");

    const inv = h.registry.invokeTool("stuck.hang", {});
    void inv.catch(() => {});
    await expect(h.registry.deactivate("stuck")).rejects.toThrow(/drain 超时/);
    expect(h.registry.status("stuck")).toBe("active");
  });
});

describe("热替换：先起后落", () => {
  test("切到新版本且旧版本被 deactivate，栈回到深度 1", async () => {
    const h = new Harness();
    const oldDeactivated = vi.fn();
    h.set(
      "svc",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "v", schema: {}, handler: async () => "v1" });
        },
        deactivate: oldDeactivated,
      }),
    );
    h.set(
      "svc",
      "2.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "v", schema: {}, handler: async () => "v2" });
        },
      }),
    );
    await h.registry.install(manifest("svc", "1.0.0"));
    await h.registry.activate("svc");
    expect(await h.registry.invokeTool("svc.v", {})).toBe("v1");

    await h.registry.replace("svc", manifest("svc", "2.0.0"));

    expect(await h.registry.invokeTool("svc.v", {})).toBe("v2");
    expect(oldDeactivated).toHaveBeenCalledOnce();
    expect(h.registry.listTools().map((t) => t.name)).toEqual(["svc.v"]);
    expect(h.registry.status("svc")).toBe("active");
  });

  test("新版本激活失败 → 原子回滚，旧版本继续服务", async () => {
    const h = new Harness();
    h.set(
      "svc",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "v", schema: {}, handler: async () => "v1" });
        },
      }),
    );
    h.set(
      "svc",
      "2.0.0",
      defineModule({
        activate() {
          throw new Error("boom");
        },
      }),
    );
    await h.registry.install(manifest("svc", "1.0.0"));
    await h.registry.activate("svc");

    await expect(h.registry.replace("svc", manifest("svc", "2.0.0"))).rejects.toThrow("boom");
    expect(h.registry.status("svc")).toBe("active");
    expect(await h.registry.invokeTool("svc.v", {})).toBe("v1");
    expect(h.registry.listTools().map((t) => t.name)).toEqual(["svc.v"]);
  });

  test("重叠期：旧代在途落旧 handler、新调用打新栈顶，drain 后栈回深度 1", async () => {
    const h = new Harness();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.set(
      "svc",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({
            name: "v",
            schema: {},
            handler: async () => {
              await gate;
              return "v1";
            },
          });
        },
      }),
    );
    h.set(
      "svc",
      "2.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "v", schema: {}, handler: async () => "v2" });
        },
      }),
    );
    await h.registry.install(manifest("svc", "1.0.0"));
    await h.registry.activate("svc");

    const oldInflight = h.registry.invokeTool("svc.v", {}); // 旧代在途，卡在 gate

    // 新版本已激活压栈顶，但旧代 drain 卡着 → replace 尚未完成
    const replacing = h.registry.replace("svc", manifest("svc", "2.0.0"));
    let replaceDone = false;
    void replacing.then(() => {
      replaceDone = true;
    });
    await delay(20);
    expect(replaceDone).toBe(false);

    // 重叠期：新调用打到新栈顶
    expect(await h.registry.invokeTool("svc.v", {})).toBe("v2");

    // 放开旧代在途：仍按它进入时的旧 handler 返回 v1
    release();
    expect(await oldInflight).toBe("v1");

    // drain 清零，replace 完成，栈回深度 1
    await replacing;
    expect(replaceDone).toBe(true);
    expect(h.registry.listTools().map((t) => t.name)).toEqual(["svc.v"]);
    expect(await h.registry.invokeTool("svc.v", {})).toBe("v2");
  });

  test("旧代 drain 超时 → replace 回滚：新版本拆除，旧版本继续 active", async () => {
    const h = new Harness({ drainTimeoutMs: 30 });
    const stuck = new Promise<void>(() => {}); // 永不 resolve，卡住旧代
    const newDeact = vi.fn();
    h.set(
      "svc",
      "1.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({
            name: "v",
            schema: {},
            handler: async () => {
              await stuck;
              return "v1";
            },
          });
        },
      }),
    );
    h.set(
      "svc",
      "2.0.0",
      defineModule({
        activate(ctx) {
          ctx.registerTool({ name: "v", schema: {}, handler: async () => "v2" });
        },
        deactivate: newDeact,
      }),
    );
    await h.registry.install(manifest("svc", "1.0.0"));
    await h.registry.activate("svc");

    const inflight = h.registry.invokeTool("svc.v", {});
    void inflight.catch(() => {});

    await expect(h.registry.replace("svc", manifest("svc", "2.0.0"))).rejects.toThrow(/drain 超时/);

    // 回滚：新版本被 deactivate + 其 tool 弹栈；旧版本仍 active（栈深回 1）
    expect(newDeact).toHaveBeenCalledOnce();
    expect(h.registry.status("svc")).toBe("active");
    expect(h.registry.listTools().map((t) => t.name)).toEqual(["svc.v"]);
  });
});

describe("版本闸门", () => {
  test("hostApiVersion 不满足 → install 拒绝", async () => {
    const h = new Harness();
    h.set("future", "1.0.0", defineModule({ activate() {} }));
    await expect(
      h.registry.install(manifest("future", "1.0.0", ">=9.0.0")),
    ).rejects.toThrow(/请升级客户端/);
    expect(h.registry.status("future")).toBe("unloaded");
  });
});

describe("main 模块 UI 区域(surface)", () => {
  const fakeSurface = (): ModuleSurface => ({
    bounds: readable({ x: 0, y: 0, width: 0, height: 0 }),
    visible: readable(false),
    theme: readable<"light" | "dark">("light"),
    detached: readable(false),
    attach: () => ({ dispose() {} }),
    detach: async () => {},
    merge: async () => {},
  });

  test("无 provider → main 模块 ctx.surface 为 undefined", async () => {
    const h = new Harness();
    let seen: unknown = "unset";
    h.set(
      "m",
      "1.0.0",
      defineModule<MainContext>({
        activate(ctx) {
          seen = ctx.surface;
        },
      }),
    );
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");
    expect(seen).toBeUndefined();
  });

  test("有 provider → main 模块 ctx 拿到 provider 产出的 surface", async () => {
    const surface = fakeSurface();
    const provide = vi.fn(() => surface);
    const h = new Harness({ surfaceProvider: { provide } });
    let seen: ModuleSurface | undefined;
    h.set(
      "m",
      "1.0.0",
      defineModule<MainContext>({
        activate(ctx) {
          seen = ctx.surface;
        },
      }),
    );
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");
    expect(provide).toHaveBeenCalledOnce();
    expect(seen).toBe(surface);
  });

  test("provider 经 track 注册的 teardown 随 deactivate 回收", async () => {
    const teardown = vi.fn();
    const provide: SurfaceProvider["provide"] = (_self, track) => {
      track({ dispose: teardown });
      return fakeSurface();
    };
    const h = new Harness({ surfaceProvider: { provide } });
    h.set("m", "1.0.0", defineModule({ activate() {} }));
    await h.registry.install(manifest("m"));
    await h.registry.activate("m");
    expect(teardown).not.toHaveBeenCalled();

    await h.registry.deactivate("m");
    expect(teardown).toHaveBeenCalledOnce();
  });
});
