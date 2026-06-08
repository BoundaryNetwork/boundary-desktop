import { describe, expect, test } from "vitest";
import type { Disposable } from "@boundary-desktop/contract";
import {
  HostServices,
  ProfileRegistry,
  type DriverCreateOptions,
  type DriverWebview,
  type StorageBackend,
  type WebviewDriver,
} from "../src/index.js";
import { wrapDriverView } from "../src/index.js";

/** 测试用最小内存 backend(共享、不命名空间)。 */
function memBackend(): StorageBackend {
  const map = new Map<string, unknown>();
  return {
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async set(k, v) {
      map.set(k, v);
    },
    async delete(k) {
      map.delete(k);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

describe("ProfileRegistry", () => {
  test("默认带 default 账号", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(await reg.list()).toEqual([{ id: "default", name: "默认" }]);
  });

  test("create 递增 id 并持久化;remove 删除;default 不可删", async () => {
    const backend = memBackend();
    const reg = new ProfileRegistry(backend);
    const a = await reg.create("店铺A");
    const b = await reg.create("店铺B");
    expect(a).toEqual({ id: "p1", name: "店铺A" });
    expect(b).toEqual({ id: "p2", name: "店铺B" });

    await reg.remove("p1");
    expect((await reg.list()).map((p) => p.id)).toEqual(["default", "p2"]);

    await expect(reg.remove("default")).rejects.toThrow();

    // 同一 backend 新建实例 → 从持久化恢复(含 seq,不复用已删 id)
    const reloaded = new ProfileRegistry(backend);
    expect((await reloaded.list()).map((p) => p.id)).toEqual(["default", "p2"]);
    const c = await reloaded.create("店铺C");
    expect(c.id).toBe("p3");
  });

  test("resolvePartition 按 profileId 给隔离分区", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(reg.resolvePartition(undefined)).toBe("persist:wv-default");
    expect(reg.resolvePartition("p1")).toBe("persist:wv-p1");
  });
});

/** 录制型假 driver:created 记录每次 create 入参,getDestroyed() 读已销毁计数。 */
function fakeDriver(): {
  driver: WebviewDriver;
  created: DriverCreateOptions[];
  getDestroyed: () => number;
} {
  const created: DriverCreateOptions[] = [];
  let destroyed = 0;
  const noop: Disposable = { dispose: () => {} };
  const driver: WebviewDriver = {
    async create(opts) {
      created.push(opts);
      return {
        async navigate() {},
        setBounds() {},
        setVisible() {},
        setInteractive() {},
        goBack() {},
        goForward() {},
        reload() {},
        on: () => noop,
        async find() {
          return null;
        },
        async click() {},
        async type() {},
        async upload() {},
        async scroll() {},
        async screenshot() {
          return new Uint8Array();
        },
        async eval<T>() {
          return undefined as T;
        },
        cdp: { send: async () => null, on: () => noop },
        destroy() {
          destroyed++;
        },
      } satisfies DriverWebview;
    },
  };
  return { driver, created, getDestroyed: () => destroyed };
}

/** 跑一次激活、拿到 ctx 的 webview 能力 + 触发回收的 track。 */
function forModuleWith(host: HostServices) {
  const disposables: Disposable[] = [];
  const track = <D extends Disposable>(d: D): D => {
    disposables.push(d);
    return d;
  };
  const caps = host.forModule({ id: "browser", version: "1.0.0", runtime: "main" }, track);
  return { caps, dispose: () => disposables.forEach((d) => d.dispose()) };
}

describe("HostServices.webview", () => {
  test("profiles 经 ctx.webview 暴露,跨模块共享同一注册表", async () => {
    const host = new HostServices();
    const { caps } = forModuleWith(host);
    await caps.webview.profiles.create("店铺A");
    // 另一个模块的 ctx 看到同一份
    const other = forModuleWith(host);
    expect((await other.caps.webview.profiles.list()).map((p) => p.name)).toContain("店铺A");
  });

  test("create 用 profile 分区调 driver,deactivate 销毁 view", async () => {
    const fake = fakeDriver();
    const host = new HostServices({ webview: fake.driver });
    const { caps, dispose } = forModuleWith(host);
    const p = await caps.webview.profiles.create("店铺A"); // p1
    const handle = await caps.webview.create({ profileId: p.id, interactive: false });
    expect(handle).toBeDefined();
    expect(fake.created[0]).toMatchObject({ partition: "persist:wv-p1", interactive: false });
    dispose(); // 模拟 deactivate 回收
    expect(fake.getDestroyed()).toBe(1);
  });

  test("未注入 driver 时 create 抛错,但 profiles 仍可用", async () => {
    const host = new HostServices();
    const { caps } = forModuleWith(host);
    await expect(caps.webview.create()).rejects.toThrow(/WebviewDriver/);
    expect(await caps.webview.profiles.list()).toHaveLength(1);
  });

  test("deactivate 先退订 on/cdp.on 订阅,再销毁 view", async () => {
    const order: string[] = [];
    const sub = (tag: string): Disposable => ({ dispose: () => order.push(tag) });
    const driver: WebviewDriver = {
      async create() {
        return {
          async navigate() {},
          setBounds() {},
          setVisible() {},
          setInteractive() {},
          goBack() {},
          goForward() {},
          reload() {},
          on: () => sub("unsub:on"),
          async find() {
            return null;
          },
          async click() {},
          async type() {},
          async upload() {},
          async scroll() {},
          async screenshot() {
            return new Uint8Array();
          },
          async eval<T>() {
            return undefined as T;
          },
          cdp: { send: async () => null, on: () => sub("unsub:cdp") },
          destroy() {
            order.push("destroy");
          },
        } satisfies DriverWebview;
      },
    };
    const host = new HostServices({ webview: driver });
    const { caps, dispose } = forModuleWith(host);
    const handle = await caps.webview.create();
    handle.on("did-navigate", () => {});
    handle.cdp.on("Page.frameNavigated", () => {});
    dispose(); // 模拟 deactivate
    expect(order).toEqual(["unsub:on", "unsub:cdp", "destroy"]);
  });
});

describe("wrapDriverView 导航控制委托", () => {
  test("goBack/goForward/reload 透传到 driver view", () => {
    const calls: string[] = [];
    const noop: Disposable = { dispose: () => {} };
    const view = {
      navigate: async () => {},
      setBounds() {},
      setVisible() {},
      setInteractive() {},
      goBack() { calls.push("back"); },
      goForward() { calls.push("forward"); },
      reload() { calls.push("reload"); },
      on: () => noop,
      find: async () => null,
      click: async () => {},
      type: async () => {},
      upload: async () => {},
      scroll: async () => {},
      screenshot: async () => new Uint8Array(),
      async eval<T>() { return undefined as T; },
      cdp: { send: async () => null, on: () => noop },
      destroy() {},
    };
    const track = <D extends Disposable>(d: D): D => d;
    const handle = wrapDriverView(view, track);
    handle.goBack();
    handle.goForward();
    handle.reload();
    expect(calls).toEqual(["back", "forward", "reload"]);
  });
});
