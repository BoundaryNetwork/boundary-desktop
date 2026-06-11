import React from "react";
import { useConversationStore, useGroupedConversations, type Conversation } from "../state/conversation";
import { useAgentStore } from "../state/agent";
import { avatarLetter, displayName, hueFromId, type AgentLike } from "../lib/agent";
import { ChevronRight, Search, Plus, X, Trash, Edit, MessageSquare } from "./icon";

function convTitle(c: Conversation): string {
  return c.name?.trim() || c.id.slice(0, 8);
}

// ─── 搜索框 ─────────────────────────────────────────────────────────────────────
function SearchBox({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange(v: string): void;
  inputRef: React.RefObject<HTMLInputElement>;
}): React.ReactElement {
  const [focused, setFocused] = React.useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-4) var(--space-6)",
        borderRadius: "var(--r-4)",
        background: "var(--bg-1)",
        border: `1px solid ${focused ? "var(--accent-ring)" : "var(--line-soft)"}`,
      }}
    >
      <Search size={14} style={{ color: "var(--fg-3)", flex: "none" }} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="搜索会话"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: "var(--text-3)",
          fontFamily: "inherit",
          color: "var(--fg-0)",
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => onChange("")}
          style={{
            width: 18,
            height: 18,
            display: "inline-grid",
            placeItems: "center",
            border: "none",
            background: "transparent",
            color: "var(--fg-3)",
            borderRadius: "var(--r-1)",
            cursor: "pointer",
            flex: "none",
          }}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

// ─── agent 行 ───────────────────────────────────────────────────────────────────
function AgentRow({
  agent,
  expanded,
  isCurrent,
  onPick,
  onNew,
}: {
  agent: AgentLike;
  expanded: boolean;
  isCurrent: boolean;
  onPick(): void;
  onNew(): void;
}): React.ReactElement {
  const [hovered, setHovered] = React.useState(false);
  const hue = hueFromId(agent.id);
  const bg = isCurrent
    ? "color-mix(in oklch, var(--accent) 7%, var(--panel-mid-bg))"
    : hovered
      ? "var(--bg-2)"
      : "transparent";

  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={displayName(agent)}
      aria-expanded={expanded}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-4)",
        marginBottom: "var(--space-1)",
        borderRadius: "var(--r-4)",
        background: bg,
        border: "none",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
        flex: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          flex: "none",
          display: "inline-grid",
          placeItems: "center",
          color: "var(--fg-3)",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 150ms ease",
        }}
      >
        <ChevronRight size={14} />
      </span>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: "var(--r-3)",
          background: `oklch(0.92 0.06 ${hue})`,
          color: `oklch(0.32 0.12 ${hue})`,
          display: "inline-grid",
          placeItems: "center",
          fontWeight: 600,
          fontSize: "var(--text-4)",
          flex: "none",
        }}
      >
        {avatarLetter(agent)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--text-4)",
          fontWeight: 500,
          color: isCurrent ? "var(--fg-0)" : "var(--fg-1)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayName(agent)}
      </span>
      <span
        role="button"
        aria-label={`新建 ${displayName(agent)} 会话`}
        title="新建会话"
        onClick={(e) => {
          e.stopPropagation();
          onNew();
        }}
        style={{
          width: 24,
          height: 24,
          flex: "none",
          display: "inline-grid",
          placeItems: "center",
          color: "var(--fg-2)",
          borderRadius: "var(--r-2)",
        }}
      >
        <Plus size={13} />
      </span>
    </button>
  );
}

// ─── 会话行 ─────────────────────────────────────────────────────────────────────
function SessionLine({
  conv,
  active,
  onPick,
  onDelete,
  onRename,
}: {
  conv: Conversation;
  active: boolean;
  onPick(): void;
  onDelete(): void;
  onRename(name: string): void;
}): React.ReactElement {
  const [hovered, setHovered] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => convTitle(conv));
  const bg = active ? "var(--accent-soft)" : hovered ? "var(--bg-2)" : "transparent";
  const color = active ? "var(--accent)" : "var(--fg-1)";

  const submit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== convTitle(conv)) onRename(next);
  };

  if (editing) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-3)",
          borderRadius: "var(--r-3)",
          background: "var(--bg-3)",
        }}
      >
        <span aria-hidden="true" style={{ width: 14, height: 14, flex: "none", display: "inline-grid", placeItems: "center", color: "var(--fg-3)" }}>
          <MessageSquare size={14} />
        </span>
        <input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--text-3)",
            fontFamily: "inherit",
            color: "var(--fg-0)",
            background: "var(--bg-1)",
            border: "1px solid var(--accent-ring)",
            outline: "none",
            borderRadius: "var(--r-2)",
            padding: "var(--space-2) var(--space-4)",
          }}
        />
      </div>
    );
  }

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onPick}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-3)",
          borderRadius: "var(--r-3)",
          background: bg,
          color,
          border: "1px solid transparent",
          fontSize: "var(--text-3)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 14, height: 14, flex: "none", display: "inline-grid", placeItems: "center", color: active ? "var(--accent)" : "var(--fg-3)" }}
        >
          <MessageSquare size={14} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {convTitle(conv)}
        </span>
        {hovered ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", flex: "none" }}>
            <span
              role="button"
              aria-label="重命名会话"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(convTitle(conv));
                setEditing(true);
              }}
              style={{ width: 20, height: 20, display: "inline-grid", placeItems: "center", color: "var(--fg-2)", borderRadius: "var(--r-2)" }}
            >
              <Edit size={12} />
            </span>
            <span
              role="button"
              aria-label="删除会话"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={{ width: 20, height: 20, display: "inline-grid", placeItems: "center", color: "var(--fg-2)", borderRadius: "var(--r-2)" }}
            >
              <Trash size={12} />
            </span>
          </span>
        ) : null}
      </button>
    </div>
  );
}

// ─── 展开的会话列表 ───────────────────────────────────────────────────────────────
function ExpandedSessions({
  sessions,
  currentId,
  onPick,
  onDelete,
  onRename,
}: {
  sessions: Conversation[];
  currentId: string | null;
  onPick(c: Conversation): void;
  onDelete(id: string): void;
  onRename(id: string, name: string): void;
}): React.ReactElement {
  return (
    <div
      style={{
        flex: "0 1 auto",
        minHeight: 0,
        overflowY: "auto",
        paddingLeft: "var(--space-4)",
        marginBottom: "var(--space-3)",
      }}
    >
      {sessions.length === 0 ? (
        <div style={{ padding: "var(--space-3) var(--space-5)", color: "var(--fg-3)", fontSize: "var(--text-4)" }}>
          暂无聊天记录
        </div>
      ) : (
        sessions.map((c) => (
          <SessionLine
            key={c.id}
            conv={c}
            active={c.id === currentId}
            onPick={() => onPick(c)}
            onDelete={() => onDelete(c.id)}
            onRename={(name) => onRename(c.id, name)}
          />
        ))
      )}
    </div>
  );
}

// ─── 骨架加载 ─────────────────────────────────────────────────────────────────────
function SkeletonList(): React.ReactElement {
  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {[80, 70, 75].map((w, i) => (
        <div key={i} className="oc-skeleton" style={{ width: `${w}%`, height: 32, borderRadius: "var(--r-3)" }} />
      ))}
    </div>
  );
}

// ─── 侧栏 ───────────────────────────────────────────────────────────────────────
export function Sidebar({
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  onSelect(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
  onRename(id: string, name: string): void;
}): React.ReactElement {
  const agentsRaw = useAgentStore((s) => s.agents);
  const status = useAgentStore((s) => s.status);
  const currentAgentId = useAgentStore((s) => s.currentAgentId);
  const setCurrentAgent = useAgentStore((s) => s.setCurrentAgent);
  const currentId = useConversationStore((s) => s.currentId);
  const setCurrentId = useConversationStore((s) => s.setCurrentId);
  const grouped = useGroupedConversations();

  const [search, setSearch] = React.useState("");
  const [expandedAgentId, setExpandedAgentId] = React.useState<string | null>(currentAgentId ?? null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (currentAgentId) setExpandedAgentId(currentAgentId);
  }, [currentAgentId]);

  // ⌘F / Ctrl+F 聚焦搜索框。
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const agents = React.useMemo<AgentLike[]>(
    () => agentsRaw.map((a) => ({ id: a.agent_instance_id, name: a.name })),
    [agentsRaw],
  );

  const handlePickAgent = (a: AgentLike): void => {
    setCurrentAgent(a.id);
    setCurrentId(null); // 进空态
    setExpandedAgentId((cur) => (cur === a.id ? null : a.id));
  };
  const handleNewSession = (a: AgentLike): void => {
    setCurrentAgent(a.id);
    setExpandedAgentId(a.id);
    onNew();
  };
  const handlePickSession = (c: Conversation): void => {
    if (c.agentInstanceId !== undefined && c.agentInstanceId !== currentAgentId) {
      setCurrentAgent(c.agentInstanceId);
    }
    onSelect(c.id);
  };

  const q = search.trim().toLowerCase();
  const matches = (c: Conversation): boolean => !q || convTitle(c).toLowerCase().includes(q);

  return (
    <aside
      style={{
        width: 248,
        flex: "0 0 248px",
        height: "100%",
        background: "var(--panel-mid-bg)",
        borderRight: "1px solid var(--line-soft)",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      <div style={{ padding: "var(--space-6) var(--space-6) var(--space-3)", flex: "none" }}>
        <SearchBox value={search} onChange={setSearch} inputRef={searchRef} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: "var(--space-2) var(--space-4) var(--space-6)",
        }}
      >
        {status === "loading" && agents.length === 0 ? (
          <SkeletonList />
        ) : status === "error" && agents.length === 0 ? (
          <div style={{ padding: "var(--space-6)", color: "var(--err)", fontSize: "var(--text-2)" }}>加载失败</div>
        ) : agents.length === 0 ? (
          <div style={{ padding: "var(--space-8)", color: "var(--fg-3)", fontSize: "var(--text-2)", textAlign: "center" }}>
            还没有数字助理
          </div>
        ) : (
          agents.map((a) => {
            const all = grouped.get(a.id) ?? [];
            const sessions = q ? all.filter(matches) : all;
            // 搜索时:命中的 agent 强制展开;无命中的 agent 隐藏。
            if (q && sessions.length === 0) return null;
            const expanded = q ? true : a.id === expandedAgentId;
            return (
              <React.Fragment key={a.id}>
                <AgentRow
                  agent={a}
                  expanded={expanded}
                  isCurrent={a.id === currentAgentId}
                  onPick={() => handlePickAgent(a)}
                  onNew={() => handleNewSession(a)}
                />
                {expanded ? (
                  <ExpandedSessions
                    sessions={sessions}
                    currentId={currentId}
                    onPick={handlePickSession}
                    onDelete={onDelete}
                    onRename={onRename}
                  />
                ) : null}
              </React.Fragment>
            );
          })
        )}
      </div>
    </aside>
  );
}
