import React from "react";
import type { RenderUnit, AssistantTurnUnit } from "../render/units";
import type { ToolCard } from "../render/tool";
import { renderMarkdown } from "../render/markdown";

const S: Record<string, React.CSSProperties> = {
  user: {
    alignSelf: "flex-end",
    maxWidth: "78%",
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-4)",
    background: "var(--accent)",
    color: "#fff",
    fontSize: "var(--text-3)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  turn: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  thinking: {
    fontSize: "var(--text-2)",
    color: "var(--fg-2)",
    background: "var(--bg-1)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-3)",
    padding: "var(--space-3) var(--space-5)",
  },
  thinkingSummary: { cursor: "pointer", userSelect: "none" },
  tool: {
    fontSize: "var(--text-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-3)",
    padding: "var(--space-3) var(--space-5)",
    background: "var(--bg-1)",
  },
  toolErr: { borderColor: "var(--danger, #e5484d)" },
  toolName: { fontFamily: "var(--font-mono, monospace)", fontWeight: 600 },
  pre: { margin: "var(--space-2) 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  meta: { fontSize: "var(--text-2)", color: "var(--fg-3, var(--fg-2))" },
};

function ThinkingBlock({ thinking }: { thinking: { text: string; streaming: boolean } }): React.ReactElement {
  return (
    <details style={S.thinking} open={thinking.streaming}>
      <summary style={S.thinkingSummary}>{thinking.streaming ? "正在思考…" : "思考过程"}</summary>
      {thinking.text && <div style={S.pre}>{thinking.text}</div>}
    </details>
  );
}

function ToolCardView({ card }: { card: ToolCard }): React.ReactElement {
  return (
    <div style={{ ...S.tool, ...(card.isError ? S.toolErr : null) }}>
      <span style={S.toolName}>{card.name}</span>
      {card.inputText && <div style={S.pre}>{card.inputText}</div>}
      {card.outputText !== undefined && <div style={S.pre}>{card.outputText}</div>}
    </div>
  );
}

function TypingDots(): React.ReactElement {
  return (
    <div className="oc-typing">
      <span />
      <span />
      <span />
    </div>
  );
}

function AssistantText({ text }: { text: string }): React.ReactElement {
  // 代码块复制按钮:事件委托(markdown.ts 只产出静态 .oc-code-copy 按钮)。
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const btn = (e.target as HTMLElement).closest(".oc-code-copy");
    if (!btn) return;
    const code = btn.parentElement?.querySelector("code");
    if (code) void navigator.clipboard.writeText(code.textContent ?? "");
  };
  return (
    <div
      className="oc-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

export function Line({ unit }: { unit: RenderUnit }): React.ReactElement | null {
  if (unit.kind === "user") {
    return <div style={S.user}>{unit.message.content}</div>;
  }
  if (unit.kind === "system") {
    return <div style={S.meta}>{unit.text}</div>;
  }
  const turn: AssistantTurnUnit = unit;
  const emptyStreaming =
    turn.streaming && !turn.text && !turn.thinking && turn.tools.length === 0;
  return (
    <div style={S.turn}>
      {turn.thinking && <ThinkingBlock thinking={turn.thinking} />}
      {turn.tools.map((t) => (
        <ToolCardView key={t.id} card={t} />
      ))}
      {turn.text && <AssistantText text={turn.text} />}
      {emptyStreaming && <TypingDots />}
      {turn.cancelled && <div style={S.meta}>已停止</div>}
    </div>
  );
}
