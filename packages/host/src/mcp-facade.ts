import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { HOST_API_VERSION } from "@boundary-desktop/contract";
import type { ToolFacade } from "./facade.js";

/** MCP 门面:把三件套(list/invoke/version)映射成 MCP 协议,接入标准 Agent 生态。
 *
 *  传输用 Streamable HTTP 的**无状态子集**:客户端 POST 单条 JSON-RPC,服务端以
 *  application/json 单条应答(无 SSE、无 session)。覆盖 initialize / tools/list /
 *  tools/call / ping,足够标准 MCP HTTP 客户端 list 到 tool 并调用。
 *
 *  无状态意味着不主动推 tools/list_changed —— 故 capabilities.tools 不声明 listChanged,
 *  客户端按需重新 list(热更新后下次 list 即见新集合)。门面只依赖 ToolFacade,不碰
 *  模块系统 / 命名空间 / 跨进程路由(与 WS 门面同构)。 */
export interface McpFacadeHandle {
  port: number;
  close(): Promise<void>;
}

interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-06-18";

export function startMcpFacade(
  facade: ToolFacade,
  opts: { port?: number; host?: string } = {},
): Promise<McpFacadeHandle> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => void handleHttp(facade, req, res));

    let started = false;
    server.on("error", (err) => {
      if (started) console.error("[mcp-facade] HTTP 服务运行时错误", err);
      else reject(err); // 启动期错误(端口占用等)让 start 失败
    });

    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => {
      started = true;
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => closeServer(server) });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((res) => server.close(() => res()));
}

async function handleHttp(facade: ToolFacade, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS:允许浏览器内的 MCP 客户端(如 web 端 agent)跨源访问。
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  // 无状态:不提供服务端发起的 SSE 流。
  if (req.method === "GET") {
    res.writeHead(405).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  // JSON-RPC 批量(数组)或单条
  if (Array.isArray(parsed)) {
    const out: object[] = [];
    for (const m of parsed) {
      const r = await dispatch(facade, m as JsonRpcReq);
      if (r) out.push(r);
    }
    if (out.length === 0) {
      res.writeHead(202).end(); // 全是通知,无应答体
      return;
    }
    sendJson(res, 200, out);
    return;
  }

  const reply = await dispatch(facade, parsed as JsonRpcReq);
  if (!reply) {
    res.writeHead(202).end(); // 通知,无应答体
    return;
  }
  sendJson(res, 200, reply);
}

/** 处理单条 JSON-RPC;通知(无 id)返回 null(不应答)。 */
async function dispatch(facade: ToolFacade, msg: JsonRpcReq): Promise<object | null> {
  const id = msg.id ?? null;
  const notification = msg.id === undefined || msg.id === null;
  const ok = (result: object): object => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): object => ({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (msg.method) {
      case "initialize": {
        const requested = (msg.params?.protocolVersion as string | undefined) ?? PROTOCOL_VERSION;
        return ok({
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: "boundary-desktop", version: HOST_API_VERSION },
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null; // 通知,无应答
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: facade.list().map((t) => ({
            name: t.name,
            description: t.description ?? "",
            inputSchema: (t.schema as object) ?? { type: "object" },
          })),
        });
      case "tools/call": {
        const name = msg.params?.name as string | undefined;
        if (!name) return fail(-32602, "tools/call 缺少 name");
        const args = (msg.params?.arguments as unknown) ?? {};
        try {
          const result = await facade.invoke(name, args);
          const text = typeof result === "string" ? result : JSON.stringify(result);
          return ok({ content: [{ type: "text", text }] });
        } catch (err) {
          // tool 执行错误按 MCP 约定回 isError 的结果(而非协议级 error)
          return ok({ content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true });
        }
      }
      default:
        if (notification) return null; // 未知通知静默
        return fail(-32601, `Method not found: ${String(msg.method)}`);
    }
  } catch (err) {
    return fail(-32603, err instanceof Error ? err.message : String(err));
  }
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(s);
}
