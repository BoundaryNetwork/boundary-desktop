import { describe, expect, test } from "vitest";
import {
  defineModule,
  type Module,
  type ModuleLoader,
  type ModuleManifest,
} from "@boundary-desktop/contract";
import { HostServices, Registry, type ArtifactSource } from "../src/index.js";

function manifest(id: string, version = "1.0.0"): ModuleManifest {
  return { id, version, runtime: "main", hostApiVersion: "*", entry: "x", integrity: "x" };
}

function makeRegistry(modules: Map<string, Module>): Registry {
  const source: ArtifactSource = { fetchArtifact: async (m) => `mem://${m.id}@${m.version}` };
  const loader: ModuleLoader = {
    canLoad: () => true,
    load: async (_path, m) => {
      const mod = modules.get(`${m.id}@${m.version}`);
      if (!mod) throw new Error(`test: 未提供模块 ${m.id}@${m.version}`);
      return mod;
    },
  };
  return new Registry({ source, loaders: [loader], capabilityHost: new HostServices() });
}

const oneTool = (toolName: string) =>
  defineModule({
    activate(ctx) {
      ctx.registerTool({ name: toolName, schema: {}, handler: async () => toolName });
    },
  });

describe("ToolFacade 三件套", () => {
  test("version 随注册/卸载/替换变化，onChange 触发", async () => {
    const mods = new Map<string, Module>();
    mods.set("svc@1.0.0", oneTool("v"));
    mods.set("svc@2.0.0", oneTool("v"));
    const reg = makeRegistry(mods);
    const facade = reg.facade();

    let changes = 0;
    facade.onChange(() => changes++);

    expect(facade.version()).toBe(0);
    expect(facade.list()).toEqual([]);

    await reg.install(manifest("svc"));
    await reg.activate("svc");
    const afterActivate = facade.version();
    expect(afterActivate).toBeGreaterThan(0);
    expect(changes).toBeGreaterThan(0);
    expect(facade.list().map((t) => t.name)).toEqual(["svc.v"]);
    expect(await facade.invoke("svc.v", {})).toBe("v");

    await reg.replace("svc", manifest("svc", "2.0.0"));
    expect(facade.version()).toBeGreaterThan(afterActivate); // 替换也变更
    expect(facade.list().map((t) => t.name)).toEqual(["svc.v"]);

    const beforeDeactivate = facade.version();
    await reg.deactivate("svc");
    expect(facade.version()).toBeGreaterThan(beforeDeactivate);
    expect(facade.list()).toEqual([]);
  });

  test("invoke 未知 tool 抛错", async () => {
    const reg = makeRegistry(new Map());
    await expect(reg.facade().invoke("nope.missing", {})).rejects.toThrow(/未注册/);
  });
});
