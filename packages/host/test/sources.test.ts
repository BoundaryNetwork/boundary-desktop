import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  HostServices,
  LocalDirSource,
  MainLoader,
  Reconciler,
  Registry,
  verifyIntegrity,
} from "../src/index.js";

const localRoot = fileURLToPath(new URL("./fixtures/local-modules", import.meta.url));

describe("verifyIntegrity", () => {
  const data = new TextEncoder().encode("hello boundary");
  const hex = createHash("sha256").update(data).digest("hex");

  test("匹配的 hash 通过", () => {
    expect(() => verifyIntegrity(data, `sha256-${hex}`)).not.toThrow();
  });
  test("不匹配 → 抛错", () => {
    expect(() => verifyIntegrity(data, "sha256-deadbeef")).toThrow(/完整性校验失败/);
  });
  test("格式非法 → 抛错", () => {
    expect(() => verifyIntegrity(data, "nodash")).toThrow(/格式非法/);
  });
});

describe("LocalDirSource", () => {
  test("catalog 扫描目录列出全部模块", async () => {
    const source = new LocalDirSource([localRoot]);
    const catalog = await source.catalog();
    expect(catalog.modules.map((m) => m.id).sort()).toEqual(["local-a", "local-b"]);
    expect(catalog.version).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  test("fetchArtifact 把 entry 解析到模块目录下的本地路径", async () => {
    const source = new LocalDirSource([localRoot]);
    const catalog = await source.catalog();
    const a = catalog.modules.find((m) => m.id === "local-a")!;
    const path = await source.fetchArtifact(a);
    expect(path).toMatch(/local-a\/index\.mjs$/);
  });

  test("端到端：LocalDirSource → Reconciler → Registry → MainLoader → tool 可调", async () => {
    const source = new LocalDirSource([localRoot]);
    const registry = new Registry({
      source,
      loaders: [new MainLoader()],
      capabilityHost: new HostServices(),
    });
    const reconciler = new Reconciler(source, registry);

    const report = await reconciler.sync();
    expect(report?.installed.sort()).toEqual(["local-a", "local-b"]);
    expect(await registry.invokeTool("local-a.hi", {})).toBe("hi-from-a");
    expect(await registry.invokeTool("local-b.hi", {})).toBe("hi-from-b");

    // catalog.version 未变 → 第二次 sync 跳过
    expect(await reconciler.sync()).toBeNull();
  });
});
