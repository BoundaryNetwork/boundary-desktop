import React from "react";
import { buildRenderUnits } from "../render/units";
import { useCurrentMessages, useCurrentSending } from "../state/stream";
import { useConversationStore } from "../state/conversation";
import { useAgentStore } from "../state/agent";
import { Line } from "./line";

const S: Record<string, React.CSSProperties> = {
  root: { position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  feed: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    minHeight: 0,
    padding: "var(--space-8) var(--space-7)",
  },
  col: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    maxWidth: "var(--chat-content-width, 760px)",
    margin: "0 auto",
    width: "100%",
  },
  empty: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    color: "var(--fg-2)",
    fontSize: "var(--text-3)",
  },
  loadingPill: {
    position: "absolute",
    top: "var(--space-3)",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1,
    pointerEvents: "none",
    padding: "var(--space-2) var(--space-5)",
    color: "var(--fg-3)",
    fontSize: "var(--text-2)",
    background: "var(--bg-2)",
    borderRadius: "var(--r-3)",
  },
  tail: { padding: "var(--space-2) var(--space-3)", color: "var(--fg-3)" },
};

const FOLLOW_EPS_PX = 8;
const JUMP_THRESHOLD_PX = 300;
const PAGE_TRIGGER_PX = 30;

export function ChatWindow({
  currentId,
  hasMore,
  loadingOlder,
  onLoadOlder,
}: {
  currentId: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
}): React.ReactElement {
  const messages = useCurrentMessages();
  const sending = useCurrentSending();
  const units = React.useMemo(() => buildRenderUnits(messages), [messages]);

  // 当前会话归属 agent 的名字(助手行展示)。
  const agentName = useAgentStore((s) => {
    const aid = useConversationStore
      .getState()
      .conversations.find((c) => c.id === currentId)?.agentInstanceId;
    return aid ? s.agents.find((a) => a.agent_instance_id === aid)?.name : undefined;
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const following = React.useRef(true);
  const prevConvRef = React.useRef<string | null>(null);
  const prevSentinelRef = React.useRef<string | null>(null);
  const prevSendingRef = React.useRef(false);
  const anchorRef = React.useRef<{ height: number; top: number; convId: string } | null>(null);
  const [showJump, setShowJump] = React.useState(false);

  const lastMsg = messages[messages.length - 1];
  const sentinel = lastMsg ? `${lastMsg.messageId}:${lastMsg.content.length}` : null;
  const firstMsgId = messages[0]?.messageId ?? null;
  const hasPending = messages.some((m) => m.pending === true);

  // 滚动:切会话无条件落底;内容增长按 following 决定是否滚。
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevConvRef.current !== currentId) {
      prevConvRef.current = currentId;
      prevSentinelRef.current = sentinel;
      el.scrollTop = el.scrollHeight;
      following.current = true;
      setShowJump(false);
      return;
    }
    if (!sentinel || sentinel === prevSentinelRef.current) return;
    prevSentinelRef.current = sentinel;
    if (following.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(dist > JUMP_THRESHOLD_PX);
    }
  }, [sentinel, currentId]);

  // 向上翻页锚定还原:首条消息变化 = prepend 落地,绘制前修正 scrollTop 消除跳动。
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    if (anchor.convId !== currentId) {
      anchorRef.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
    anchorRef.current = null;
  }, [firstMsgId, currentId]);

  // 发送即跟随:sending false→true 时强制恢复跟随并落底。
  React.useEffect(() => {
    if (sending && !prevSendingRef.current) {
      following.current = true;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        setShowJump(false);
      }
    }
    prevSendingRef.current = sending;
  }, [sending]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    following.current = dist < FOLLOW_EPS_PX;
    setShowJump(!following.current && dist > JUMP_THRESHOLD_PX);
    if (!currentId) return;
    if (el.scrollTop < 0 || el.scrollTop > PAGE_TRIGGER_PX) return; // <0 挡 macOS 橡皮筋
    if (!hasMore || loadingOlder) return;
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop, convId: currentId };
    onLoadOlder();
  };

  const onJump = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setShowJump(false);
  };

  if (!currentId) {
    return <div style={S.empty}>选择或新建一个会话开始对话</div>;
  }

  return (
    <div style={S.root}>
      {loadingOlder ? <div style={S.loadingPill}>加载中…</div> : null}
      <div ref={scrollRef} style={S.feed} onScroll={onScroll}>
        <div style={S.col}>
          {units.map((u) => (
            <Line key={u.key} unit={u} agentName={agentName} />
          ))}
          {sending && !hasPending ? (
            <div style={S.tail}>
              <div className="oc-typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {showJump ? <JumpButton onClick={onJump} /> : null}
    </div>
  );
}

function JumpButton({ onClick }: { onClick(): void }): React.ReactElement {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      aria-label="回到底部"
      title="回到底部"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: "50%",
        bottom: "var(--space-5)",
        transform: "translateX(-50%)",
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: hovered ? "var(--accent-soft)" : "var(--bg-0)",
        border: "1px solid var(--line)",
        color: hovered ? "var(--accent)" : "var(--fg-2)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  );
}
