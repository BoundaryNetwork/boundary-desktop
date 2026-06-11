import React from "react";
import { usePrefsStore } from "../state/prefs";
import { ChevronDown, More, Edit, Trash, Refresh, Check } from "./icon";

// 会话主区顶栏:中列标题(点开下拉:重命名/删除,或内联重命名 input);
// 右列视图菜单(刷新 + 显示思考过程 + 显示工具调用)。对齐 agent-ui ChatHeader 的可用子集。

const HEADER_H = 48;

function useDismiss(ref: React.RefObject<HTMLElement>, onClose: () => void): void {
  React.useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

const menuItem: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-4) var(--space-5)",
  borderRadius: "var(--r-2)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--fg-1)",
  textAlign: "left",
  fontSize: "var(--text-3)",
  fontFamily: "inherit",
};

function MenuShell({
  left,
  top,
  width,
  onClose,
  children,
}: {
  left: number;
  top: number;
  width: number;
  onClose(): void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  // position:fixed 不被 overflow:hidden 祖先裁剪,等效 body portal 但不引入 react-dom 依赖。
  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: Math.min(Math.max(8, left), window.innerWidth - width - 8),
        top,
        width,
        background: "var(--bg-0)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-4)",
        boxShadow: "var(--shadow-2, 0 8px 24px rgba(0,0,0,0.12))",
        padding: "var(--space-2)",
        zIndex: 100,
      }}
    >
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick(): void;
}): React.ReactElement {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onClick} style={menuItem}>
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          display: "inline-grid",
          placeItems: "center",
          width: 14,
          height: 14,
          borderRadius: "var(--r-1)",
          border: `1px solid ${checked ? "var(--accent)" : "var(--line)"}`,
          background: checked ? "var(--accent)" : "transparent",
          color: "#fff",
        }}
      >
        {checked ? <Check size={10} /> : null}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

export function ChatHeader({
  title,
  onRefresh,
  onRename,
  onDelete,
}: {
  title: string;
  onRefresh(): void;
  onRename(next: string): void;
  onDelete(): void;
}): React.ReactElement {
  const showThinking = usePrefsStore((s) => s.showThinking);
  const showToolCalls = usePrefsStore((s) => s.showToolCalls);
  const setPrefs = usePrefsStore((s) => s.set);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [titleMenu, setTitleMenu] = React.useState<{ left: number; top: number } | null>(null);
  const [viewMenu, setViewMenu] = React.useState<{ left: number; top: number } | null>(null);
  const titleBtnRef = React.useRef<HTMLButtonElement>(null);
  const viewBtnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const startRename = (): void => {
    setTitleMenu(null);
    setDraft(title);
    setEditing(true);
  };
  const submitRename = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
  };
  const openTitleMenu = (): void => {
    const r = titleBtnRef.current?.getBoundingClientRect();
    if (r) setTitleMenu({ left: r.left, top: r.bottom + 4 });
  };
  const openViewMenu = (): void => {
    const r = viewBtnRef.current?.getBoundingClientRect();
    if (r) setViewMenu({ left: r.right - 184, top: r.bottom + 4 });
  };

  return (
    <div
      style={{
        flex: "none",
        display: "grid",
        gridTemplateColumns: "1fr minmax(0, auto) 1fr",
        alignItems: "center",
        height: HEADER_H,
        padding: "0 var(--space-6)",
        background: "var(--panel-main-bg)",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <div />
      <div style={{ justifySelf: "center", minWidth: 0, maxWidth: "100%" }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            style={{
              minWidth: 200,
              maxWidth: "100%",
              fontSize: "var(--text-3)",
              fontWeight: 600,
              fontFamily: "inherit",
              textAlign: "center",
              color: "var(--fg-0)",
              background: "var(--bg-2)",
              border: "1px solid var(--accent-ring)",
              borderRadius: "var(--r-2)",
              padding: "var(--space-2) var(--space-4)",
              outline: "none",
            }}
          />
        ) : (
          <button
            ref={titleBtnRef}
            type="button"
            title={title}
            onClick={() => (titleMenu ? setTitleMenu(null) : openTitleMenu())}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              maxWidth: "100%",
              minWidth: 0,
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--r-2)",
              background: titleMenu ? "var(--bg-3)" : "transparent",
              border: 0,
              color: "var(--fg-0)",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-3)",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {title}
            </span>
            <ChevronDown size={12} style={{ flex: "none", color: "var(--fg-3)" }} />
          </button>
        )}
      </div>
      <div style={{ justifySelf: "end" }}>
        <button
          ref={viewBtnRef}
          type="button"
          title="视图选项"
          aria-label="视图选项"
          onClick={() => (viewMenu ? setViewMenu(null) : openViewMenu())}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--r-3)",
            background: viewMenu ? "var(--bg-3)" : "transparent",
            border: 0,
            color: viewMenu ? "var(--fg-0)" : "var(--fg-2)",
            cursor: "pointer",
          }}
        >
          <More size={16} />
        </button>
      </div>

      {titleMenu ? (
        <MenuShell left={titleMenu.left} top={titleMenu.top} width={160} onClose={() => setTitleMenu(null)}>
          <button type="button" style={menuItem} onClick={startRename}>
            <Edit size={13} />
            <span>重命名</span>
          </button>
          <div aria-hidden="true" style={{ height: 1, margin: "var(--space-2) var(--space-3)", background: "var(--line-soft)" }} />
          <button
            type="button"
            style={{ ...menuItem, color: "var(--err, #e5484d)" }}
            onClick={() => {
              setTitleMenu(null);
              onDelete();
            }}
          >
            <Trash size={13} />
            <span>删除</span>
          </button>
        </MenuShell>
      ) : null}

      {viewMenu ? (
        <MenuShell left={viewMenu.left} top={viewMenu.top} width={184} onClose={() => setViewMenu(null)}>
          <button
            type="button"
            style={menuItem}
            onClick={() => {
              setViewMenu(null);
              onRefresh();
            }}
          >
            <Refresh size={13} />
            <span>刷新</span>
          </button>
          <div aria-hidden="true" style={{ height: 1, margin: "var(--space-2) var(--space-3)", background: "var(--line-soft)" }} />
          <CheckRow checked={showThinking} label="显示思考过程" onClick={() => setPrefs({ showThinking: !showThinking })} />
          <CheckRow checked={showToolCalls} label="显示工具调用" onClick={() => setPrefs({ showToolCalls: !showToolCalls })} />
        </MenuShell>
      ) : null}
    </div>
  );
}
