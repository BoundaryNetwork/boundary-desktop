import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { ToolFacade } from "./facade.js";

/** 默认门面：WebSocket。把三件套映射成极简协议，tool 变更主动推送。
 *
 *  client → server： { id, type: "list" | "version" | "invoke", name?, args? }
 *  server → client： { id, type: "result", result } | { id, type: "error", error }
 *  server 推送：      { type: "changed", version }
 *
 *  握手期鉴权(opts.token):带 Origin 的连接(浏览器)一律拒;有 token 时校验
 *  Authorization: Bearer <token> 头或 ?token= 查询参数。门面只依赖 ToolFacade，
 *  不碰模块系统 / 命名空间 / 跨进程路由。 */
export interface WsFacadeHandle {
  port: number;
  close(): Promise<void>;
}

interface IncomingMessage {
  id?: string;
  type?: string;
  name?: string;
  args?: unknown;
}

export function startWsFacade(
  facade: ToolFacade,
  opts: { port?: number; host?: string; token?: string } = {},
): Promise<WsFacadeHandle> {
  return new Promise((resolve, reject) => {
    const token = opts.token;
    // 握手期鉴权:带 Origin(浏览器)一律拒,防 localhost CSRF;有 token 则校验
    // Authorization: Bearer <token> 头或 ?token= 查询参数。非浏览器客户端不带 Origin。
    const verifyClient = (info: { origin?: string; req: { headers: Record<string, unknown>; url?: string } }): boolean => {
      if (info.origin) return false;
      if (!token) return true;
      const auth = String(info.req.headers.authorization ?? "");
      if (auth === `Bearer ${token}`) return true;
      try {
        const q = new URL(info.req.url ?? "/", "http://localhost").searchParams.get("token");
        return q === token;
      } catch {
        return false;
      }
    };
    const wss = new WebSocketServer({ port: opts.port ?? 0, host: opts.host ?? "127.0.0.1", verifyClient });

    let started = false;
    wss.on("error", (err) => {
      if (started) console.error("[ws-facade] WebSocketServer 运行时错误", err);
      else reject(err); // 启动期错误（端口占用等）让 start 失败
    });
    wss.on("connection", (socket) => {
      socket.on("message", (raw) => handleMessage(facade, socket, raw.toString()));
    });

    const changeSub = facade.onChange(() => {
      const frame = JSON.stringify({ type: "changed", version: facade.version() });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(frame);
      }
    });

    wss.on("listening", () => {
      started = true;
      const port = (wss.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            changeSub.dispose();
            wss.close(() => res());
          }),
      });
    });
  });
}

async function handleMessage(facade: ToolFacade, socket: WebSocket, raw: string): Promise<void> {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw) as IncomingMessage;
  } catch {
    socket.send(JSON.stringify({ type: "error", error: "报文不是合法 JSON" }));
    return;
  }

  const reply = (body: object) => socket.send(JSON.stringify({ id: msg.id, ...body }));

  try {
    switch (msg.type) {
      case "list":
        reply({ type: "result", result: facade.list() });
        break;
      case "version":
        reply({ type: "result", result: facade.version() });
        break;
      case "invoke": {
        if (!msg.name) throw new Error("invoke 缺少 name");
        const result = await facade.invoke(msg.name, msg.args);
        reply({ type: "result", result });
        break;
      }
      default:
        reply({ type: "error", error: `未知 type：${String(msg.type)}` });
    }
  } catch (err) {
    reply({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
}
