import { describe, expect, test } from "vitest";
import {
  defineModule,
  type Module,
  type ModuleLoader,
  type ModuleManifest,
  type NetworkState,
} from "@boundary-desktop/contract";
import {
  HostServices,
  Registry,
  StateContainer,
  type ApiDriver,
  type AuthDriver,
  type ArtifactSource,
  type CapabilityHost,
} from "../src/index.js";

function manifest(id: string): ModuleManifest {
  return { id, version: "1.0.0", runtime: "main", hostApiVersion: "*", entry: "x", integrity: "x" };
}

function makeRegistry(host: CapabilityHost, modules: Map<string, Module>): Registry {
  const source: ArtifactSource = { fetchArtifact: async (m) => `mem://${m.id}` };
  const loader: ModuleLoader = {
    canLoad: () => true,
    load: async (_path, m) => {
      const mod = modules.get(m.id);
      if (!mod) throw new Error(`test: 未提供模块 ${m.id}`);
      return mod;
    },
  };
  return new Registry({ source, loaders: [loader], capabilityHost: host });
}

async function installActivate(reg: Registry, id: string): Promise<void> {
  await reg.install(manifest(id));
  await reg.activate(id);
}

describe("StateContainer", () => {
  test("set 通知订阅者，同值不通知，dispose 后停止通知", () => {
    const c = new StateContainer(1);
    const seen: number[] = [];
    const d = c.subscribe((v) => seen.push(v));

    c.set(2);
    c.set(2); // 同值，不通知
    c.set(3);
    expect(c.get()).toBe(3);
    expect(seen).toEqual([2, 3]);

    d.dispose();
    c.set(4);
    expect(seen).toEqual([2, 3]);
  });
});

describe("HostServices 能力", () => {
  test("storage 按 module id 命名空间隔离", async () => {
    const host = new HostServices();
    const mods = new Map<string, Module>();
    const mk = (val: string) =>
      defineModule({
        async activate(ctx) {
          await ctx.storage.set("k", val);
          ctx.registerTool({ name: "read", schema: {}, handler: async () => ctx.storage.get("k") });
        },
      });
    mods.set("a", mk("A"));
    mods.set("b", mk("B"));
    const reg = makeRegistry(host, mods);

    await installActivate(reg, "a");
    await installActivate(reg, "b");

    expect(await reg.invokeTool("a.read", {})).toBe("A");
    expect(await reg.invokeTool("b.read", {})).toBe("B"); // 同 key "k" 互不可见
  });

  test("auth：requestLogin 经 driver 置 token 与状态，logout 清除", async () => {
    const driver: AuthDriver = {
      login: async () => ({ token: "tok-1", user: { id: "u1", name: "Alice" } }),
      logout: async () => {},
    };
    const host = new HostServices({ auth: driver });
    const captured: Record<string, unknown> = {};
    const mods = new Map<string, Module>([
      [
        "m",
        defineModule({
          async activate(ctx) {
            captured.before = ctx.auth.getToken();
            await ctx.auth.requestLogin();
            captured.token = ctx.auth.getToken();
            captured.authed = ctx.auth.get().authenticated;
            captured.user = ctx.auth.get().user?.name;
            await ctx.auth.requestLogout();
            captured.afterLogout = ctx.auth.getToken();
            captured.authedAfter = ctx.auth.get().authenticated;
          },
        }),
      ],
    ]);

    await installActivate(makeRegistry(host, mods), "m");

    expect(captured.before).toBeNull();
    expect(captured.token).toBe("tok-1");
    expect(captured.authed).toBe(true);
    expect(captured.user).toBe("Alice");
    expect(captured.afterLogout).toBeNull();
    expect(captured.authedAfter).toBe(false);
  });

  test("api.request 委托 driver 并注入当前 token", async () => {
    let seen: { path: string; token: string | null } | undefined;
    const apiDriver: ApiDriver = {
      request: async (opts, token) => {
        seen = { path: opts.path, token };
        return { ok: true };
      },
    };
    const host = new HostServices({
      auth: { login: async () => ({ token: "tok-1", user: { id: "u1", name: "A" } }), logout: async () => {} },
      api: apiDriver,
    });
    let res: unknown;
    const mods = new Map<string, Module>([
      [
        "m",
        defineModule({
          async activate(ctx) {
            await ctx.auth.requestLogin();
            res = await ctx.api.request({ method: "GET", path: "/x" });
          },
        }),
      ],
    ]);

    await installActivate(makeRegistry(host, mods), "m");

    expect(seen).toEqual({ path: "/x", token: "tok-1" });
    expect(res).toEqual({ ok: true });
  });

  test("共享状态订阅随 deactivate 自动回收", async () => {
    const host = new HostServices();
    const received: NetworkState[] = [];
    const mods = new Map<string, Module>([
      [
        "m",
        defineModule({
          activate(ctx) {
            ctx.network.subscribe((n) => received.push(n));
          },
        }),
      ],
    ]);
    const reg = makeRegistry(host, mods);
    await installActivate(reg, "m");

    host.updateNetwork({ online: true, connected: true });
    expect(received).toHaveLength(1);

    await reg.deactivate("m");
    host.updateNetwork({ online: false, connected: false });
    expect(received).toHaveLength(1); // 已退订，不再收到
  });

  test("未配置 AuthDriver 时 requestLogin 抛错", async () => {
    const host = new HostServices();
    const mods = new Map<string, Module>([
      ["m", defineModule({ async activate(ctx) { await ctx.auth.requestLogin(); } })],
    ]);
    await expect(installActivate(makeRegistry(host, mods), "m")).rejects.toThrow(/未配置 AuthDriver/);
  });
});
