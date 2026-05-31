import type { ToolDefinition } from "@boundary-desktop/contract";
import type { WebContents } from "electron";

interface ToolDeps {
  /** 当前活动标签的 webContents(无则 null)。 */
  active: () => WebContents | null;
  /** 新建标签并设为活动,返回 id。 */
  openTab: (url: string) => number;
}

const rec = (a: unknown): Record<string, unknown> => (a && typeof a === "object" ? (a as Record<string, unknown>) : {});
const str = (a: unknown, k: string): string | undefined => {
  const v = rec(a)[k];
  return typeof v === "string" ? v : undefined;
};
const num = (a: unknown, k: string): number | undefined => {
  const v = rec(a)[k];
  return typeof v === "number" ? v : undefined;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 浏览器能力工具(Phase 3a:webContents 可达的子集)。注册时框架自动加 `browser.` 前缀,
 *  经 WS/MCP/CLI 门面 list/invoke。handler 在主进程直接驱动活动标签,无跨进程往返。
 *  CDP 系(click/type/upload/intercept_next)留 Phase 3b。 */
export function browserTools(deps: ToolDeps): ToolDefinition[] {
  const wc = (): WebContents => {
    const w = deps.active();
    if (!w || w.isDestroyed()) throw new Error("无活动标签");
    return w;
  };
  const js = (code: string): Promise<unknown> => wc().executeJavaScript(code, true);

  return [
    {
      name: "new_tab",
      description: "新建标签页(可选初始 URL),返回 tabId",
      schema: { type: "object", properties: { url: { type: "string" } } },
      handler: async (a) => ({ tabId: deps.openTab(str(a, "url") ?? "") }),
    },
    {
      name: "navigate",
      description: "在当前活动标签打开 URL",
      schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
      handler: async (a) => {
        const url = str(a, "url");
        if (!url) throw new Error("navigate 需要 url");
        const w = wc();
        await w.loadURL(url).catch((e: unknown) => {
          if (!String(e).includes("ERR_ABORTED")) throw e; // 重定向取消属正常
        });
        return { url: w.getURL(), title: w.getTitle() };
      },
    },
    {
      name: "get_text",
      description: "取页面或指定选择器元素的文本",
      schema: { type: "object", properties: { selector: { type: "string" } } },
      handler: async (a) => {
        const sel = str(a, "selector");
        const code = sel
          ? `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? null)`
          : "document.body.innerText";
        return { text: await js(code) };
      },
    },
    {
      name: "screenshot",
      description: "截取当前页面,返回 base64 PNG data URL",
      schema: { type: "object", properties: {} },
      handler: async () => {
        const img = await wc().capturePage();
        return { dataUrl: `data:image/png;base64,${img.toPNG().toString("base64")}` };
      },
    },
    {
      name: "eval",
      description: "在活动标签执行 JavaScript(支持 await),返回结果",
      schema: { type: "object", required: ["js"], properties: { js: { type: "string" } } },
      handler: async (a) => {
        const code = str(a, "js");
        if (!code) throw new Error("eval 需要 js");
        return { result: await js(code) };
      },
    },
    {
      name: "scroll",
      description: "滚动页面或指定元素(deltaY 正下负上)",
      schema: {
        type: "object",
        required: ["deltaY"],
        properties: { selector: { type: "string" }, deltaY: { type: "number" } },
      },
      handler: async (a) => {
        const dy = num(a, "deltaY") ?? 0;
        const sel = str(a, "selector");
        const target = sel ? `(document.querySelector(${JSON.stringify(sel)})||document.scrollingElement)` : "window";
        await js(`${target}.scrollBy(0, ${dy})`);
        return { ok: true };
      },
    },
    {
      name: "wait_for",
      description: "等待选择器元素出现(默认 30s 超时)",
      schema: {
        type: "object",
        required: ["selector"],
        properties: { selector: { type: "string" }, timeout: { type: "number" } },
      },
      handler: async (a) => {
        const sel = str(a, "selector");
        if (!sel) throw new Error("wait_for 需要 selector");
        const timeout = num(a, "timeout") ?? 30000;
        const deadline = Date.now() + timeout;
        const probe = `!!document.querySelector(${JSON.stringify(sel)})`;
        for (;;) {
          if (await js(probe)) return { found: true };
          if (Date.now() >= deadline) throw new Error(`等待元素超时: ${sel}`);
          await sleep(200);
        }
      },
    },
  ];
}
