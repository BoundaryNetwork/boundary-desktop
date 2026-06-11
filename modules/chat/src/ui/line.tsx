import React from "react";
import type { RenderUnit, AssistantTurnUnit } from "../render/units";
import type { ToolCard } from "../render/tool";
import type { TurnUsage } from "../types";
import { renderMarkdown } from "../render/markdown";
import { usePrefsStore } from "../state/prefs";
import { Bot, Copy, Check } from "./icon";

const S: Record<string, React.CSSProperties> = {
  userRow: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  user: {
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
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    color: "var(--fg-2)",
    fontSize: "var(--text-2)",
    fontFamily: "var(--font-mono, monospace)",
  },
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: "var(--r-circle, 9999px)",
    background: "var(--accent-soft)",
    color: "var(--accent)",
    flexShrink: 0,
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
  meta: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-4)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "var(--text-1)",
    color: "var(--fg-3, var(--fg-2))",
  },
  cancelled: { fontSize: "var(--text-2)", color: "var(--warn, var(--fg-2))" },
  copyBtn: {
    width: 22,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: 0,
    borderRadius: "var(--r-2)",
    background: "transparent",
    cursor: "pointer",
    padding: 0,
  },
};

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const onClick = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      title="复制"
      aria-label="复制消息内容"
      onClick={onClick}
      style={{ ...S.copyBtn, color: copied ? "var(--accent)" : "var(--fg-3)" }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

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

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    const s = k.toFixed(1);
    return (s.endsWith(".0") ? String(Math.round(k)) : s) + "k";
  }
  return String(n);
}

function UsageBadges({ usage }: { usage: TurnUsage }): React.ReactElement {
  return (
    <>
      <span title="输入 tokens">↑{formatTokens(usage.input_tokens)}</span>
      <span title="输出 tokens">↓{formatTokens(usage.output_tokens)}</span>
    </>
  );
}

function UserLine({ unit }: { unit: Extract<RenderUnit, { kind: "user" }> }): React.ReactElement {
  const text = unit.message.content;
  return (
    <div style={S.userRow}>
      <div style={S.user}>{text}</div>
      <div style={{ ...S.meta, marginTop: "var(--space-2)" }}>
        {text.trim() ? <CopyButton text={text} /> : null}
        <span>You{unit.message.timestamp ? ` · ${formatTime(unit.message.timestamp)}` : ""}</span>
      </div>
    </div>
  );
}

function AssistantLine({
  turn,
  agentName,
}: {
  turn: AssistantTurnUnit;
  agentName?: string;
}): React.ReactElement {
  const showThinking = usePrefsStore((s) => s.showThinking);
  const showToolCalls = usePrefsStore((s) => s.showToolCalls);

  const name = agentName ?? "Assistant";
  const renderThinking = turn.thinking !== null && showThinking;
  const renderTools = turn.tools.length > 0 && showToolCalls;
  const showTyping = turn.streaming && !turn.thinking?.streaming;
  const usage = turn.finalAssistant?.usage;
  const ts = turn.finalAssistant?.timestamp;

  return (
    <div style={S.turn}>
      <div style={S.agentRow}>
        <span style={S.avatar}>
          <Bot size={12} />
        </span>
        <span>{name}</span>
      </div>
      {renderThinking && turn.thinking ? <ThinkingBlock thinking={turn.thinking} /> : null}
      {renderTools ? turn.tools.map((t) => <ToolCardView key={t.id} card={t} />) : null}
      {turn.text ? <AssistantText text={turn.text} /> : null}
      {showTyping ? <TypingDots /> : null}
      {turn.cancelled ? <div style={S.cancelled}>已停止</div> : null}
      {!turn.streaming ? (
        <div style={S.meta}>
          <span>
            {name}
            {ts ? ` · ${formatTime(ts)}` : ""}
          </span>
          {usage ? <UsageBadges usage={usage} /> : null}
          {turn.text.trim() ? <CopyButton text={turn.text} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Line({ unit, agentName }: { unit: RenderUnit; agentName?: string }): React.ReactElement | null {
  if (unit.kind === "user") return <UserLine unit={unit} />;
  if (unit.kind === "system") return <div style={S.meta}>{unit.text}</div>;
  return <AssistantLine turn={unit} agentName={agentName} />;
}
