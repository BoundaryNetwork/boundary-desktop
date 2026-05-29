// 示例 renderer 模块:纯 JS、无外部 import,经 ctx 渲染聊天界面并注册 tool。
// 经 app:// 被渲染进程动态 import。框架无关——直接用 DOM 渲染进 ctx.container。
export default {
  activate(ctx) {
    const user = ctx.auth.get().user;
    const who = (user && user.name) || "你";

    // 注册 tool:基座登记为 "chat.ask"(自动加 id 前缀);handler 留在渲染进程,
    // 被调用时经 main → IPC 回这里执行(外部 WS 客户端 invoke chat.ask 亦走此链路)。
    ctx.registerTool({
      name: "ask",
      schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      description: "向对话模块提问(示例,回声)",
      handler: async (args) => {
        const q = (args && args.q) || "";
        return { answer: `（示例回复）收到：${q}` };
      },
    });

    ctx.container.innerHTML = `
      <div class="chat">
        <div class="chat__hello">
          <div class="chat__avatar">小</div>
          <h2>你好，我是小达</h2>
          <p class="chat__role">店长助理 · 很高兴为你服务</p>
        </div>
        <div class="chat__feed"></div>
        <div class="chat__suggests">
          <button type="button">帮我分析上周的销售数据</button>
          <button type="button">哪些商品的 ROI 最高？</button>
          <button type="button">写一份双十一活动方案</button>
        </div>
        <form class="chat__input">
          <input type="text" placeholder="今天要做点什么？" />
          <button type="submit">发送</button>
        </form>
      </div>`;

    const feed = ctx.container.querySelector(".chat__feed");
    const form = ctx.container.querySelector(".chat__input");
    const input = form.querySelector("input");

    function append(role, text) {
      const row = document.createElement("div");
      row.className = "chat__msg chat__msg--" + role;
      row.textContent = text;
      feed.appendChild(row);
      feed.scrollTop = feed.scrollHeight;
    }

    async function send(q) {
      if (!q.trim()) return;
      append("user", q);
      input.value = "";
      // 调用自己注册的 tool —— 经基座路由(renderer → main → renderer),验证 IPC tool 链路
      const res = await ctx.invokeTool("chat.ask", { q });
      append("bot", (res && res.answer) || "(无回复)");
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void send(input.value);
    });
    ctx.container.querySelectorAll(".chat__suggests button").forEach((btn) => {
      btn.addEventListener("click", () => void send(btn.textContent || ""));
    });

    ctx.notify({ level: "info", message: `对话模块已就绪（${who}）` });
  },
};
