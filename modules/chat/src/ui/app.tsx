import React from "react";
import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import { useConversationStore } from "../state/conversation";
import { useAgentStore } from "../state/agent";
import { useCurrentSending } from "../state/stream";
import * as api from "../api/conversations";
import { Sidebar } from "./sidebar";
import { ChatHeader } from "./header";
import { ChatWindow } from "./window";
import { Composer } from "./composer";
import { EmptyState } from "./empty";

const S: Record<string, React.CSSProperties> = {
  root: { height: "100%", display: "flex" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--panel-main-bg)" },
};

export function ChatApp({ ctx, ws }: { ctx: RendererContext; ws: ChatWs }): React.ReactElement {
  const currentId = useConversationStore((s) => s.currentId);
  const conversations = useConversationStore((s) => s.conversations);
  const sending = useCurrentSending();
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [text, setText] = React.useState("");

  // per-conv 草稿:会话切换时保存旧、恢复新(空态保留本地 text 不清)。
  const draftsRef = React.useRef<Record<string, string>>({});
  const prevIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevIdRef.current;
    if (prev !== null && prev !== currentId) draftsRef.current[prev] = text;
    if (currentId !== null) setText(draftsRef.current[currentId] ?? "");
    prevIdRef.current = currentId;
    // text 仅在 currentId 切换时读写,故只依赖 currentId。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const fail = React.useCallback(
    (message: string) => (e: unknown) => ctx.notify({ level: "error", message, detail: String(e) }),
    [ctx],
  );

  React.useEffect(() => {
    // 先拉 agent 列表(多实例路由的归属源),选首个为当前 agent,再并发拉各 agent 会话。
    // cancelled 守卫:StrictMode 下旧激活的 ChatApp 卸载即置位,旧链不再写本模块单例 store。
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
  const onRename = (id: string, next: string): void => {
    void api.renameConversation(ctx, id, next).catch(fail("重命名失败"));
  };
  const onRefresh = (): void => {
    void api
      .loadAllConversations(ctx)
      .then((list) => useConversationStore.getState().upsertMany(list))
      .catch(fail("刷新会话列表失败"));
  };
  const onSend = (value: string): void => {
    if (currentId) api.send(ws, currentId, value);
    else void api.ask(ctx, ws, value).then(() => setHasMore(false)).catch(fail("发送失败"));
  };
  const onStop = (): void => {
    if (currentId) api.stopTurn(ws, currentId);
  };
  const onLoadOlder = (): void => {
    if (!currentId || loadingOlder) return;
    setLoadingOlder(true);
    void api
      .loadOlder(ctx, currentId)
      .then(setHasMore)
      .catch(fail("加载历史失败"))
      .finally(() => setLoadingOlder(false));
  };

  const composer = <Composer value={text} onChange={setText} sending={sending} onSend={onSend} onStop={onStop} />;

  const currentTitle = (() => {
    const c = conversations.find((x) => x.id === currentId);
    return c?.name?.trim() || (currentId ? currentId.slice(0, 8) : "");
  })();

  return (
    <div style={S.root}>
      <Sidebar onSelect={onSelect} onNew={onNew} onDelete={onDelete} onRename={onRename} />
      <div style={S.main}>
        {currentId == null ? (
          <EmptyState onFill={setText}>{composer}</EmptyState>
        ) : (
          <>
            <ChatHeader
              title={currentTitle}
              onRefresh={onRefresh}
              onRename={(next) => onRename(currentId, next)}
              onDelete={() => onDelete(currentId)}
            />
            <ChatWindow currentId={currentId} hasMore={hasMore} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
            {composer}
          </>
        )}
      </div>
    </div>
  );
}
