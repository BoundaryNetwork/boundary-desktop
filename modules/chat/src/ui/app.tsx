import React from "react";
import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import { useConversationStore } from "../state/conversation";
import { useAgentStore } from "../state/agent";
import { useCurrentSending } from "../state/stream";
import * as api from "../api/conversations";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./window";
import { Composer } from "./composer";
import { EmptyState } from "./empty";

const S: Record<string, React.CSSProperties> = {
  root: { height: "100%", display: "flex" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--panel-main-bg)" },
};

export function ChatApp({ ctx, ws }: { ctx: RendererContext; ws: ChatWs }): React.ReactElement {
  const currentId = useConversationStore((s) => s.currentId);
  const sending = useCurrentSending();
  const [hasMore, setHasMore] = React.useState(false);
  const [text, setText] = React.useState("");

  const fail = React.useCallback(
    (message: string) => (e: unknown) => ctx.notify({ level: "error", message, detail: String(e) }),
    [ctx],
  );

  React.useEffect(() => {
    // 先拉 agent 列表(多实例路由的归属源),选首个为当前 agent,再并发拉各 agent 会话。
    // cancelled 守卫:StrictMode 下旧激活的 ChatApp 卸载即置位,旧链不再写本模块单例 store
    //(出站 ctx 调用已由壳层 activation-retire 兜底,这里只挡模块自有状态的陈旧写入)。
    let cancelled = false;
    void api
      .listAgents(ctx)
      .then((agents) => {
        if (cancelled) return;
        const ag = useAgentStore.getState();
        ag.setAgents(agents);
        ag.setStatus("ready");
        if (ag.currentAgentId === undefined && agents[0]) ag.setCurrentAgent(agents[0].agent_instance_id);
      })
      .catch((e) => {
        if (cancelled) return;
        useAgentStore.getState().setStatus("error");
        fail("加载 Agent 列表失败")(e);
      })
      .then(() => (cancelled ? [] : api.loadAllConversations(ctx)))
      .then((list) => {
        if (!cancelled) useConversationStore.getState().upsertMany(list);
      })
      .catch((e) => {
        if (!cancelled) fail("加载会话列表失败")(e);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, fail]);

  const onSelect = (id: string): void => {
    void api.selectConversation(ctx, ws, id).then(setHasMore).catch(fail("打开会话失败"));
  };
  const onNew = (): void => {
    void api
      .newConversation(ctx, ws)
      .then(() => setHasMore(false))
      .catch(fail("新建会话失败"));
  };
  const onDelete = (id: string): void => {
    void api.removeConversation(ctx, ws, id).catch(fail("删除会话失败"));
  };
  const onSend = (value: string): void => {
    if (currentId) api.send(ws, currentId, value);
    else void api.ask(ctx, ws, value).then(() => setHasMore(false)).catch(fail("发送失败"));
  };
  const onStop = (): void => {
    if (currentId) api.stopTurn(ws, currentId);
  };
  const onLoadOlder = (): void => {
    if (currentId) void api.loadOlder(ctx, currentId).then(setHasMore).catch(fail("加载历史失败"));
  };

  const composer = (
    <Composer value={text} onChange={setText} sending={sending} onSend={onSend} onStop={onStop} />
  );

  return (
    <div style={S.root}>
      <Sidebar onSelect={onSelect} onNew={onNew} onDelete={onDelete} />
      <div style={S.main}>
        {currentId == null ? (
          <EmptyState onFill={setText}>{composer}</EmptyState>
        ) : (
          <>
            <ChatWindow currentId={currentId} hasMore={hasMore} onLoadOlder={onLoadOlder} />
            {composer}
          </>
        )}
      </div>
    </div>
  );
}
