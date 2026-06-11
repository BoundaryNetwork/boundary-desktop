import React from "react";
import { useCurrentMessages } from "../state/stream";
import { useConnStore } from "../state/conn";
import { usePrefsStore } from "../state/prefs";
import { composerHistory, useComposerHistory } from "../lib/history";

const S: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    gap: "var(--space-4)",
    padding: "var(--space-5) var(--space-7)",
    borderTop: "1px solid var(--line)",
    alignItems: "flex-end",
  },
  box: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: "var(--r-5)",
    background: "var(--bg-1)",
    borderWidth: 1,
    borderStyle: "solid",
    transition: "border-color 120ms ease",
  },
  badge: {
    fontSize: "var(--text-2)",
    color: "var(--fg-3)",
    opacity: 0.6,
    pointerEvents: "none",
    userSelect: "none",
    padding: "var(--space-2) var(--space-6) 0",
  },
  area: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 44,
    maxHeight: 160,
    padding: "var(--space-4) var(--space-6)",
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "none",
    fontSize: "var(--text-3)",
    fontFamily: "inherit",
    lineHeight: 1.5,
    color: "var(--fg-0)",
  },
  btn: { height: 44, padding: "0 var(--space-9)", borderRadius: "var(--r-5)", flex: "none" },
};

export function Composer({
  value,
  onChange,
  sending,
  onSend,
  onStop,
}: {
  value: string;
  onChange(text: string): void;
  sending: boolean;
  onSend(text: string): void;
  onStop(): void;
}): React.ReactElement {
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = React.useState(false);
  const connected = useConnStore((s) => s.connected);
  const submitOnEnter = usePrefsStore((s) => s.submitOnEnter);

  const messages = useCurrentMessages();
  const history = React.useMemo(() => composerHistory(messages), [messages]);
  const { handleHistoryKey, inBrowseMode, badge } = useComposerHistory({
    taRef,
    input: value,
    setInput: onChange,
    history,
  });

  // 自动高度:随内容增减(上限由 maxHeight 接管为滚动)。
  React.useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = (): void => {
    const t = value.trim();
    if (!t || !connected || sending) return;
    onSend(t);
    onChange("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (handleHistoryKey(e)) return;
    // IME 合成中(中文输入法选词)回车不发送。
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (submitOnEnter) {
      if (e.shiftKey) return; // Shift+Enter 换行
    } else {
      if (!(e.metaKey || e.ctrlKey)) return; // mod-Enter 模式
    }
    e.preventDefault();
    submit();
  };

  const placeholder = connected ? "今天要做点什么？" : "等待 gateway 连接…";

  return (
    <div style={S.row}>
      <div style={{ ...S.box, borderColor: focused ? "var(--accent-ring)" : "var(--line)" }}>
        {inBrowseMode && badge ? (
          <div style={S.badge}>
            历史 {badge.current}/{badge.total}
          </div>
        ) : null}
        <textarea
          ref={taRef}
          rows={1}
          style={S.area}
          value={value}
          placeholder={placeholder}
          disabled={!connected}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      {sending ? (
        <button type="button" className="bd-btn" style={S.btn} onClick={onStop}>
          停止
        </button>
      ) : (
        <button
          type="button"
          className="bd-btn bd-btn--primary"
          style={S.btn}
          onClick={submit}
          disabled={!connected || !value.trim()}
        >
          发送
        </button>
      )}
    </div>
  );
}
