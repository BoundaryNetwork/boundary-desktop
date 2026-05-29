import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import {
  defineModule,
  type Module,
  type ModuleLoader,
  type ModuleManifest,
} from "@boundary-desktop/contract";
import {
  HostServices,
  Registry,
  startWsFacade,
  type ArtifactSource,
  type WsFacadeHandle,
} from "../src/index.js";

function manifest(id: string): ModuleManifest {
  return { id, version: "1.0.0", runtime: "main", hostApiVersion: "*", entry: "x", integrity: "x" };
}

function makeRegistry(modules: Map<string, Module>): Registry {
  const source: ArtifactSource = { fetchArtifact: async (m) => `mem://${m.id}` };
  const loader: ModuleLoader = {
    canLoad: () => true,
    load: async (_path, m) => modules.get(m.id) ?? Promise.reject(new Error(`no ${m.id}`)),
  };
  return new Registry({ source, loaders: [loader], capabilityHost: new HostServices() });
}

const echo = (id: string) =>
  defineModule({
    activate(ctx) {
      ctx.registerTool({ name: "echo", schema: {}, handler: async (a) => a });
    },
    // 避免未使用告警：id 仅用于区分模块
    deactivate() {
      void id;
    },
  });

/** 把 socket 收到的消息排成队列，next() 取下一条（按到达顺序）。 */
function queue(ws: WebSocket): { next: () => Promise<Record<string, unknown>> } {
  const buf: Record<string, unknown>[] = [];
  const waiters: Array<(m: Record<string, unknown>) => void> = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as Record<string, unknown>;
    const w = waiters.shift();
    if (w) w(m);
    else buf.push(m);
  });
  return {
    next: () =>
      buf.length
        ? Promise.resolve(buf.shift() as Record<string, unknown>)
        : new Promise((r) => waiters.push(r)),
  };
}

function open(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let server: WsFacadeHandle | undefined;
let client: WebSocket | undefined;

afterEach(async () => {
  client?.close();
  await server?.close();
  server = undefined;
  client = undefined;
});

describe("WS 门面", () => {
  test("list / invoke / 未知 type / 变更推送", async () => {
    const mods = new Map<string, Module>([
      ["a", echo("a")],
      ["b", echo("b")],
    ]);
    const reg = makeRegistry(mods);
    await reg.install(manifest("a"));
    await reg.activate("a");

    server = await startWsFacade(reg.facade());
    client = await open(server.port);
    const q = queue(client);

    // list
    client.send(JSON.stringify({ id: "1", type: "list" }));
    const listed = await q.next();
    expect(listed).toMatchObject({ id: "1", type: "result" });
    expect((listed.result as { name: string }[]).map((t) => t.name)).toEqual(["a.echo"]);

    // invoke
    client.send(JSON.stringify({ id: "2", type: "invoke", name: "a.echo", args: { hi: 1 } }));
    expect(await q.next()).toEqual({ id: "2", type: "result", result: { hi: 1 } });

    // 未知 type → error
    client.send(JSON.stringify({ id: "3", type: "frobnicate" }));
    const errored = await q.next();
    expect(errored).toMatchObject({ id: "3", type: "error" });

    // 服务端激活新模块 → 客户端收到变更推送
    await reg.install(manifest("b"));
    await reg.activate("b");
    const pushed = await q.next();
    expect(pushed.type).toBe("changed");
    expect(typeof pushed.version).toBe("number");
  });
});
