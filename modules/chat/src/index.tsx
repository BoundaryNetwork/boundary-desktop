// 示例 renderer 模块:用 TSX + React 编写,经构建工具链产出 app:// ESM 产物。
// react / react-dom 为 external,运行时由壳经 import map 共享(模块不打包 React)。
// RendererContext 为 type-only 引用(构建期抹除,无运行时依赖)。
// 样式契约:公共控件用壳发布的设计系统类 bd-*(输入/按钮/胶囊),
// 仅对话专属布局(欢迎区/消息流/气泡)走模块内联 + token。不依赖壳的私有类。
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RendererContext } from "@boundary-desktop/contract";

const SUGGESTS = ["帮我分析上周的销售数据", "哪些商品的 ROI 最高？", "写一份双十一活动方案"];

// 对话专属布局(非通用组件,留模块内)。
const S: Record<string, React.CSSProperties> = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "var(--space-13) var(--space-11)",
    gap: "var(--space-8)",
  },
  hello: { textAlign: "center", marginTop: "var(--space-13)" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: "var(--r-5)",
    background: "var(--accent-soft)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    fontSize: "var(--text-6)",
    margin: "0 auto var(--space-6)",
  },
  role: { color: "var(--fg-2)", fontSize: "var(--text-3)" },
  feed: {
    flex: 1,
    width: "100%",
    maxWidth: 640,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    padding: "var(--space-4) 0",
  },
  msg: {
    maxWidth: "80%",
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-4)",
    fontSize: "var(--text-3)",
  },
  msgUser: { alignSelf: "flex-end", background: "var(--accent)", color: "#fff" },
  msgBot: { alignSelf: "flex-start", background: "var(--bg-1)", border: "1px solid var(--line)" },
  suggests: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-4)",
    justifyContent: "center",
    maxWidth: 640,
  },
  inputRow: { width: "100%", maxWidth: 640, display: "flex", gap: "var(--space-4)" },
  // 对话输入是更高的 composer:复用 bd-input 外观,仅尺寸内联覆盖。
  composer: { flex: 1, height: 44, padding: "0 var(--space-7)", borderRadius: "var(--r-5)" },
  send: { height: 44, padding: "0 var(--space-9)", borderRadius: "var(--r-5)" },
};

function ChatApp({ ctx }: { ctx: RendererContext }): React.ReactElement {
  const who = ctx.auth.get().user?.name ?? "你";
  const [msgs, setMsgs] = React.useState<Array<{ role: "user" | "bot"; text: string }>>([]);
  const [text, setText] = React.useState("");

  async function send(q: string): Promise<void> {
    if (!q.trim()) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setText("");
    // 调用自己注册的 tool —— 经基座路由(renderer → main → renderer)
    const res = (await ctx.invokeTool("chat.ask", { q })) as { answer?: string };
    setMsgs((m) => [...m, { role: "bot", text: res?.answer ?? "(无回复)" }]);
  }

  return (
    <div style={S.root}>
      <div style={S.hello}>
        <div style={S.avatar}>小</div>
        <h2>你好，我是小达</h2>
        <p style={S.role}>店长助理 · 很高兴为你服务（{who}）</p>
      </div>
      <div style={S.feed}>
        {msgs.map((m, i) => (
          <div key={i} style={{ ...S.msg, ...(m.role === "user" ? S.msgUser : S.msgBot) }}>
            {m.text}
          </div>
        ))}
      </div>
      <div style={S.suggests}>
        {SUGGESTS.map((s) => (
          <button key={s} type="button" className="bd-chip" onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        style={S.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className="bd-input"
          style={S.composer}
          type="text"
          value={text}
          placeholder="今天要做点什么？"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="bd-btn bd-btn--primary" style={S.send}>
          发送
        </button>
      </form>
    </div>
  );
}

let root: Root | null = null;

const mod = {
  activate(ctx: RendererContext): void {
    // tool handler 留在渲染进程,被调用时经 main → IPC 回这里执行
    ctx.registerTool({
      name: "ask",
      schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      description: "向对话模块提问(示例,回声)",
      handler: async (args) => {
        const q = (args as { q?: string })?.q ?? "";
        return { answer: `（示例回复）收到：${q}` };
      },
    });
    root = createRoot(ctx.container);
    root.render(<ChatApp ctx={ctx} />);
    ctx.notify({ level: "info", message: "对话模块已就绪" });
  },
  deactivate(): void {
    root?.unmount();
    root = null;
  },
};

export default mod;
