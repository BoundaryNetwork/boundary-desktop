import React from "react";
import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import { useConversationStore } from "../state/conversation";
import { useCurrentSending } from "../state/stream";
import * as api from "../api/conversations";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./window";
import { Composer } from "./composer";

const S: Record<string, React.CSSProperties> = {
  root: { height: "100%", display: "flex" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
};

export function ChatApp({ ctx, ws }: { ctx: RendererContext; ws: ChatWs }): React.ReactElement {
  const currentId = useConversationStore((s) => s.currentId);
  const sending = useCurrentSending();
  const [hasMore, setHasMore] = React.useState(false);

  const fail = React.useCallback(
    (message: string) => (e: unknown) => ctx.notify({ level: "error", message, detail: String(e) }),
    [ctx],
  );

  React.useEffect(() => {
    void api
      .listConversations(ctx)
      .then((list) => useConversationStore.getState().setConversations(list))
      .catch(fail("加载会话列表失败"));
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
  const onSend = (text: string): void => {
    if (currentId) api.send(ws, currentId, text);
    else void api.ask(ctx, ws, text).then(() => setHasMore(false)).catch(fail("发送失败"));
  };
  const onStop = (): void => {
    if (currentId) api.stopTurn(ws, currentId);
  };
  const onLoadOlder = (): void => {
    if (currentId) void api.loadOlder(ctx, currentId).then(setHasMore).catch(fail("加载历史失败"));
  };

  return (
    <div style={S.root}>
      <Sidebar onSelect={onSelect} onNew={onNew} onDelete={onDelete} />
      <div style={S.main}>
        <ChatWindow currentId={currentId} hasMore={hasMore} onLoadOlder={onLoadOlder} />
        <Composer sending={sending} onSend={onSend} onStop={onStop} />
      </div>
    </div>
  );
}
