import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { ModuleManifest } from "@boundary-desktop/contract";
import { HostServices, MainLoader, Registry, type ArtifactSource } from "../src/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-main-module.mjs", import.meta.url));

function mainManifest(id: string): ModuleManifest {
  return { id, version: "1.0.0", runtime: "main", hostApiVersion: "*", entry: "x", integrity: "x" };
}

describe("MainLoader 端到端", () => {
  test("import 落盘的 main 模块 → 激活后 tool 可被调用", async () => {
    const source: ArtifactSource = { fetchArtifact: async () => fixturePath };
    const reg = new Registry({
      source,
      loaders: [new MainLoader()],
      capabilityHost: new HostServices(),
    });

    await reg.install(mainManifest("sample"));
    await reg.activate("sample");

    expect(reg.status("sample")).toBe("active");
    expect(reg.listTools().map((t) => t.name)).toEqual(["sample.echo"]);
    expect(await reg.invokeTool("sample.echo", { hi: 1 })).toEqual({ hi: 1 });
  });

  test("canLoad 只认 runtime=main", () => {
    const loader = new MainLoader();
    expect(loader.canLoad(mainManifest("x"))).toBe(true);
    expect(loader.canLoad({ ...mainManifest("x"), runtime: "renderer" })).toBe(false);
  });

  test("产物缺合法 default 导出 → 加载失败", async () => {
    const badPath = fileURLToPath(new URL("./fixtures/no-default-module.mjs", import.meta.url));
    await expect(new MainLoader().load(badPath, mainManifest("bad"))).rejects.toThrow(
      /缺少合法的 default 导出/,
    );
  });
});
