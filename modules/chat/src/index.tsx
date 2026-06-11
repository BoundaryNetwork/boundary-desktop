// chat 模块入口:activate 接线协议/状态/UI,注册 chat.open + chat.ask。
// react / react-dom external(壳 import map 共享);RendererContext type-only。
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RendererContext } from "@boundary-desktop/contract";
import { ChatApp } from "./ui/app";
import { ChatWs } from "./protocol/ws";
import { createFrameDispatcher } from "./protocol/handlers";
import { useConversationStore } from "./state/conversation";
import { useConvStreamStore } from "./state/stream";
import * as api from "./api/conversations";
import cssText from "./ui/chat.css";

interface WorkerEndpoint {
  addr: string;
  port: number;
}

/** 从 ctx.config 读 agentworkerd.ws 端点拼 ws url。host 在发现 worker 后经 config 通道下发
 *  agentworkerd = { http?, ws? },每项 { addr, port }(见 apps/shell/src/main/index.ts)。 */
function wsBase(ctx: RendererContext): string | null {
  const cfg = ctx.config.get() as { agentworkerd?: { ws?: WorkerEndpoint } };
  const ws = cfg.agentworkerd?.ws;
  return ws ? `ws://${ws.addr}:${ws.port}/ws` : null;
}

let root: Root | null = null;
let ws: ChatWs | null = null;
let styleEl: HTMLStyleElement | null = null;
let configSub: { dispose(): void } | null = null;
let lastWsBase: string | null = null;

const mod = {
  activate(ctx: RendererContext): void {
    styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);

    const dispatch = createFrameDispatcher((opts) => ctx.notify(opts));
    ws = new ChatWs({
      url: () => wsBase(ctx),
      token: () => ctx.auth.getToken(), // 每次连接前现取,刷新/吊销后即最新
      onFrame: dispatch,
    });
    lastWsBase = wsBase(ctx);
    ws.connect();

    // worker 重启换端口 → ws base 变才重连(无关 config 变化不打扰)。
    configSub = ctx.config.subscribe(() => {
      const next = wsBase(ctx);
      if (next !== lastWsBase) {
        lastWsBase = next;
        ws?.reconnect();
      }
    });

    // open:把对话模块切到前台(供别的模块 invokeTool("chat.open") 调用)。
    ctx.registerTool({
      name: "open",
      schema: { type: "object", properties: {} },
      description: "把对话模块切到前台",
      handler: async (_args, inv) => {
        ctx.navigate("chat");
        return { ok: true, caller: inv.caller };
      },
    });
    // ask:外部发起一次提问(无当前会话则新建),切到前台。
    ctx.registerTool({
      name: "ask",
      schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      description: "向对话发起一次提问",
      handler: async (args) => {
        const q = (args as { q?: string })?.q ?? "";
        ctx.navigate("chat");
        if (ws && q.trim()) await api.ask(ctx, ws, q);
        return { ok: true };
      },
    });

    root = createRoot(ctx.container);
    root.render(<ChatApp ctx={ctx} ws={ws} />);
  },

  deactivate(): void {
    root?.unmount();
    root = null;
    ws?.close();
    ws = null;
    configSub?.dispose();
    configSub = null;
    styleEl?.remove();
    styleEl = null;
    lastWsBase = null;
    // 清模块自有状态:同 bundle deactivate→reactivate 时 store 是持久单例,
    // 不清会让 selectConversation 命中"已有 entry 跳重拉"路径而显示陈旧历史。
    useConversationStore.getState().setConversations([]);
    useConversationStore.getState().setCurrentId(null);
    useConvStreamStore.setState({ byConversation: {} });
    api.resetInstance(); // reactivate 后按新 worker 重新解析 agent_instance_id
  },
};

export default mod;
