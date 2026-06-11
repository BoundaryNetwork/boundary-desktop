import React from "react";

const S: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    gap: "var(--space-4)",
    padding: "var(--space-5) var(--space-7)",
    borderTop: "1px solid var(--line)",
    alignItems: "flex-end",
  },
  area: {
    flex: 1,
    minHeight: 44,
    maxHeight: 160,
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-5)",
    resize: "none",
    fontSize: "var(--text-3)",
    lineHeight: 1.5,
  },
  btn: { height: 44, padding: "0 var(--space-9)", borderRadius: "var(--r-5)" },
};

export function Composer({
  sending,
  onSend,
  onStop,
}: {
  sending: boolean;
  onSend(text: string): void;
  onStop(): void;
}): React.ReactElement {
  const [text, setText] = React.useState("");

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div style={S.row}>
      <textarea
        className="bd-textarea"
        style={S.area}
        value={text}
        placeholder="今天要做点什么？"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {sending ? (
        <button type="button" className="bd-btn" style={S.btn} onClick={onStop}>
          停止
        </button>
      ) : (
        <button type="button" className="bd-btn bd-btn--primary" style={S.btn} onClick={submit}>
          发送
        </button>
      )}
    </div>
  );
}
