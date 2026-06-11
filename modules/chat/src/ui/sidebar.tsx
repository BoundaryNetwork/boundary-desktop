import React from "react";
import { useConversationStore } from "../state/conversation";

const S: Record<string, React.CSSProperties> = {
  root: {
    width: 248,
    flex: "0 0 248px",
    borderRight: "1px solid var(--line)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-1)",
  },
  head: {
    padding: "var(--space-5) var(--space-5)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: "var(--text-3)", fontWeight: 600 },
  list: { flex: 1, overflowY: "auto", padding: "0 var(--space-3) var(--space-4)" },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--r-3)",
    cursor: "pointer",
    fontSize: "var(--text-3)",
    color: "var(--fg-1)",
  },
  itemActive: { background: "var(--accent-soft)", color: "var(--accent)" },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  del: {
    border: "none",
    background: "transparent",
    color: "var(--fg-3, var(--fg-2))",
    cursor: "pointer",
    fontSize: "var(--text-2)",
    padding: "0 var(--space-2)",
  },
};

export function Sidebar({
  onSelect,
  onNew,
  onDelete,
}: {
  onSelect(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
}): React.ReactElement {
  const conversations = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>对话</span>
        <button type="button" className="bd-chip" onClick={onNew}>
          新建
        </button>
      </div>
      <div style={S.list}>
        {conversations.map((c) => (
          <div
            key={c.id}
            style={{ ...S.item, ...(c.id === currentId ? S.itemActive : null) }}
            onClick={() => onSelect(c.id)}
          >
            <span style={S.name}>{c.name?.trim() || "新会话"}</span>
            <button
              type="button"
              style={S.del}
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
