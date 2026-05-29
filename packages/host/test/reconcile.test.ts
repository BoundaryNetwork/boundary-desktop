import { describe, expect, test } from "vitest";
import {
  defineModule,
  type Module,
  type ModuleLoader,
  type ModuleManifest,
} from "@boundary-desktop/contract";
import {
  HostServices,
  Reconciler,
  Registry,
  type Catalog,
  type ModuleSource,
} from "../src/index.js";

function manifest(id: string, version: string): ModuleManifest {
  return { id, version, runtime: "main", hostApiVersion: "*", entry: "x", integrity: "x" };
}

/** 受控的内存来源：catalog 可随测试改写。 */
class FakeSource implements ModuleSource {
  catalogValue: Catalog;
  constructor(initial: Catalog) {
    this.catalogValue = initial;
  }
  async catalog(): Promise<Catalog> {
    return this.catalogValue;
  }
  async fetchArtifact(m: ModuleManifest): Promise<string> {
    return `mem://${m.id}@${m.version}`;
  }
}

/** 按 id@version 取模块，tool handler 返回带版本的 tag，便于断言替换生效。 */
function makeLoader(): ModuleLoader {
  const build = (id: string, version: string): Module =>
    defineModule({
      activate(ctx) {
        ctx.registerTool({ name: "tag", schema: {}, handler: async () => `${id}@${version}` });
      },
    });
  return {
    canLoad: () => true,
    load: async (_path, m) => build(m.id, m.version),
  };
}

describe("Reconciler 对账", () => {
  test("install / replace / uninstall / 同版本跳过", async () => {
    const source = new FakeSource({ version: "1", modules: [manifest("a", "1.0.0")] });
    const registry = new Registry({
      source,
      loaders: [makeLoader()],
      capabilityHost: new HostServices(),
    });
    const reconciler = new Reconciler(source, registry);

    // v1：装 a
    const r1 = await reconciler.sync();
    expect(r1?.installed).toEqual(["a"]);
    expect(registry.status("a")).toBe("active");
    expect(await registry.invokeTool("a.tag", {})).toBe("a@1.0.0");

    // 同 catalog 版本 → 跳过
    expect(await reconciler.sync()).toBeNull();

    // v2：a 升版本 + 新增 b
    source.catalogValue = { version: "2", modules: [manifest("a", "2.0.0"), manifest("b", "1.0.0")] };
    const r2 = await reconciler.sync();
    expect(r2?.replaced).toEqual(["a"]);
    expect(r2?.installed).toEqual(["b"]);
    expect(await registry.invokeTool("a.tag", {})).toBe("a@2.0.0"); // 替换生效
    expect(await registry.invokeTool("b.tag", {})).toBe("b@1.0.0");

    // v3：去掉 a，保留 b
    source.catalogValue = { version: "3", modules: [manifest("b", "1.0.0")] };
    const r3 = await reconciler.sync();
    expect(r3?.uninstalled).toEqual(["a"]);
    expect(r3?.unchanged).toEqual(["b"]);
    expect(registry.status("a")).toBe("unloaded");
    await expect(registry.invokeTool("a.tag", {})).rejects.toThrow(/未注册/);
  });

  test("同版本 inactive 模块：重装拉回 active（无 inactive→active 转移）", async () => {
    const source = new FakeSource({ version: "1", modules: [manifest("a", "1.0.0")] });
    const registry = new Registry({
      source,
      loaders: [makeLoader()],
      capabilityHost: new HostServices(),
    });
    const reconciler = new Reconciler(source, registry);

    await reconciler.sync();
    expect(registry.status("a")).toBe("active");

    // 旁路 deactivate，把 a 打到 inactive（reconcile 自身不会产生此态，但旁路调用会）
    await registry.deactivate("a");
    expect(registry.status("a")).toBe("inactive");

    // 同模块版本、新 catalog.version 触发对账 → 不靠 inactive→active，走重装
    source.catalogValue = { version: "2", modules: [manifest("a", "1.0.0")] };
    const r = await reconciler.sync();
    expect(r?.installed).toEqual(["a"]);
    expect(registry.status("a")).toBe("active");
    expect(await registry.invokeTool("a.tag", {})).toBe("a@1.0.0");
  });
});
