// 示例 renderer 模块:用 TSX + React 编写,经构建工具链产出 app:// ESM 产物。
// react / react-dom 为 external,运行时由壳经 import map 共享(模块不打包 React)。
// RendererContext 为 type-only 引用(构建期抹除,无运行时依赖)。
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RendererContext } from "@boundary-desktop/contract";

const SUGGESTS = ["帮我分析上周的销售数据", "哪些商品的 ROI 最高？", "写一份双十一活动方案"];

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
    <div className="chat">
      <div className="chat__hello">
        <div className="chat__avatar">小</div>
        <h2>你好，我是小达</h2>
        <p className="chat__role">店长助理 · 很高兴为你服务（{who}）</p>
      </div>
      <div className="chat__feed">
        {msgs.map((m, i) => (
          <div key={i} className={`chat__msg chat__msg--${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="chat__suggests">
        {SUGGESTS.map((s) => (
          <button key={s} type="button" onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="chat__input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          type="text"
          value={text}
          placeholder="今天要做点什么？"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">发送</button>
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
