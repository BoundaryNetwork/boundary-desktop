import React from "react";
import { buildRenderUnits } from "../render/units";
import { useCurrentMessages } from "../state/stream";
import { Line } from "./line";

const S: Record<string, React.CSSProperties> = {
  feed: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    padding: "var(--space-6) var(--space-7)",
  },
  empty: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    color: "var(--fg-2)",
    fontSize: "var(--text-3)",
  },
  older: { alignSelf: "center" },
};

const STICK_THRESHOLD_PX = 80;

export function ChatWindow({
  currentId,
  hasMore,
  onLoadOlder,
}: {
  currentId: string | null;
  hasMore: boolean;
  onLoadOlder(): void;
}): React.ReactElement {
  const messages = useCurrentMessages();
  const units = React.useMemo(() => buildRenderUnits(messages), [messages]);
  const ref = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [units]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  if (!currentId) {
    return <div style={S.empty}>选择或新建一个会话开始对话</div>;
  }

  return (
    <div ref={ref} style={S.feed} onScroll={onScroll}>
      {hasMore && (
        <button type="button" className="bd-chip" style={S.older} onClick={onLoadOlder}>
          加载更早
        </button>
      )}
      {units.map((u) => (
        <Line key={u.key} unit={u} />
      ))}
    </div>
  );
}
