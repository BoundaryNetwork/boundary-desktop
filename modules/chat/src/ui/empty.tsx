import React from "react";
import { useAgentStore } from "../state/agent";
import { displayName } from "../lib/agent";
import { Bot, ChevronRight } from "./icon";

// 无会话时的欢迎屏:bot 图标 + "你好,我是 <agent>" + 装饰线 + 副标题 + 推荐 chips。
// agent 无 identity 字段,bot 图标与副标题固定降级。

const SUGGESTIONS = [
  "帮我分析上周的销售数据",
  "哪些商品的 ROI 最高？",
  "写一份双十一活动方案",
  "优化爆款商品的标题和卖点",
];

const S: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 var(--space-8) var(--space-8)",
    minHeight: 0,
  },
  welcome: {
    width: "100%",
    maxWidth: 680,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "var(--space-4)",
  },
  botBox: {
    width: 64,
    height: 64,
    borderRadius: "var(--r-5)",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-ring)",
    display: "grid",
    placeItems: "center",
    color: "var(--accent)",
  },
  greeting: { fontSize: "var(--text-9)", fontWeight: 500, color: "var(--fg-0)" },
  line: { width: 48, height: 2, borderRadius: 9999, background: "var(--accent-ring)" },
  desc: { fontSize: "var(--text-3)", color: "var(--fg-2)" },
  bottom: {
    width: "100%",
    maxWidth: 680,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  list: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-4)" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-4)",
    background: "var(--bg-1)",
    border: "1px solid var(--line-soft)",
    color: "var(--fg-1)",
    fontSize: "var(--text-3)",
    fontFamily: "inherit",
    cursor: "pointer",
  },
};

export function EmptyState({
  onFill,
  children,
}: {
  onFill(text: string): void;
  children?: React.ReactNode;
}): React.ReactElement {
  const name = useAgentStore((s) => {
    const a = s.agents.find((x) => x.agent_instance_id === s.currentAgentId);
    return a ? displayName({ id: a.agent_instance_id, name: a.name }) : "";
  });

  return (
    <div style={S.root}>
      <div style={{ flex: 1, minHeight: 24 }} />
      <div style={S.welcome}>
        <div style={S.botBox}>
          <Bot size={30} />
        </div>
        <div style={S.greeting}>
          你好,{"  "}我是 <span style={{ color: "var(--accent)" }}>{name}</span>
        </div>
        <div style={S.line} />
        <div style={S.desc}>很高兴为你服务</div>
      </div>
      <div style={{ flex: 1, minHeight: 32 }} />
      <div style={S.bottom}>
        <div style={S.list}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" style={S.chip} onClick={() => onFill(s)}>
              <span>{s}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
