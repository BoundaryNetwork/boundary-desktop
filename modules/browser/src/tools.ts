import type { ToolDefinition, WebviewHandle } from "@boundary-desktop/contract";
import { click, findElement, interceptNext, setInputFiles, typeText } from "./automation.js";

interface ToolDeps {
  /** 当前活动标签的 view 句柄(无则 null)。 */
  active: () => WebviewHandle | null;
  /** 新建标签并设为活动,返回 id;指定 profile 则在该账号(不存在自动建)隔离会话中打开。 */
  openTab: (url: string, profile?: string) => Promise<number>;
  /** 列出账号(profile):id / 名 / 是否当前。 */
  listProfiles: () => Promise<{ id: string; name: string; current: boolean }[]>;
  /** 请求把浏览器区域提到前台(agent 驱动导航时浮出给用户看)。 */
  foreground: () => void;
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
const strArr = (a: unknown, k: string): string[] => {
  const v = rec(a)[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 页内执行:收集可见可交互元素 + 为每个算稳定唯一选择器。优先级:
 *  #id(过滤动态 id)> data-*(含 id/test/qa/cy)> [name]/[aria-label]/[placeholder] > a[href]
 *  > 结构路径(nth-of-type,锚到最近稳定 id 祖先)。每级都验 querySelectorAll 唯一,不唯一即降级。
 *  String.raw 保留正则反斜杠原样。take `max` 上限封顶省 token。 */
const SNAPSHOT_FN = String.raw`function(max){
  function vis(el){var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;var s=getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none';}
  function esc(s){try{return CSS.escape(s);}catch(e){return s;}}
  function uniq(sel){try{return document.querySelectorAll(sel).length===1;}catch(e){return false;}}
  var DYN=/(^[0-9])|[:\s]|^(ember|ext-|mui-|radix-|headlessui-|react-|svelte-|v-)|[0-9a-f]{12,}/i;
  function qv(v){return v.replace(/\\/g,'\\\\').replace(/"/g,'\\"');}
  function byId(el){var id=el.id;if(!id||DYN.test(id))return null;var s='#'+esc(id);return uniq(s)?s:null;}
  function byData(el){for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i];if(/^data-/.test(a.name)&&/(id|test|qa|cy)/i.test(a.name)&&a.value){var s='['+a.name+'="'+qv(a.value)+'"]';if(uniq(s))return s;}}return null;}
  function byAttr(el){var ats=['name','aria-label','placeholder'];for(var i=0;i<ats.length;i++){var v=el.getAttribute(ats[i]);if(v){var s=el.tagName.toLowerCase()+'['+ats[i]+'="'+qv(v)+'"]';if(uniq(s))return s;}}return null;}
  function byHref(el){if(el.tagName==='A'){var h=el.getAttribute('href');if(h&&h.length<120&&!/^javascript:/i.test(h)){var s='a[href="'+qv(h)+'"]';if(uniq(s))return s;}}return null;}
  function path(el){var parts=[];while(el&&el.nodeType===1&&el.tagName!=='BODY'){var ids=byId(el);if(ids){parts.unshift(ids);break;}var tag=el.tagName.toLowerCase();var p=el.parentElement;if(!p){parts.unshift(tag);break;}var same=Array.prototype.filter.call(p.children,function(c){return c.tagName===el.tagName;});parts.unshift(same.length>1?tag+':nth-of-type('+(same.indexOf(el)+1)+')':tag);el=p;}return parts.join(' > ');}
  function sel(el){return byId(el)||byData(el)||byAttr(el)||byHref(el)||path(el);}
  function nm(el){var n=(el.getAttribute('aria-label')||el.innerText||el.value||el.getAttribute('placeholder')||el.getAttribute('alt')||el.getAttribute('title')||'').trim().replace(/\s+/g,' ');return n.slice(0,80);}
  var Q='a,button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[onclick],[contenteditable="true"],[contenteditable=""]';
  var nodes=document.querySelectorAll(Q),out=[],seen={};
  for(var i=0;i<nodes.length&&out.length<max;i++){var el=nodes[i];if(!vis(el))continue;var s=sel(el);if(!s||seen[s])continue;seen[s]=1;var o={tag:el.tagName.toLowerCase(),name:nm(el),sel:s};var role=el.getAttribute('role');if(role)o.role=role;var ty=el.getAttribute('type');if(ty)o.type=ty;out.push(o);}
  return {url:location.href,title:document.title,count:out.length,truncated:nodes.length>max,elements:out};
}`;

/** 浏览器能力工具。注册时框架自动加 `browser.` 前缀,经 WS/MCP/CLI 门面 list/invoke;
 *  handler 在主进程直接驱动活动标签,无跨进程往返。click/type/upload/intercept_next 经
 *  kernel WebviewHandle 的 cdp 通道,合成可信输入(反检测)。 */
export function browserTools(deps: ToolDeps): ToolDefinition[] {
  const h = (): WebviewHandle => {
    const w = deps.active();
    if (!w) throw new Error("无活动标签");
    return w;
  };
  const js = (code: string): Promise<unknown> => h().eval(code);

  return [
    {
      name: "new_tab",
      description: "新建标签页(可选初始 URL),返回 tabId。指定 profile 则在该账号隔离会话中打开(不存在自动建)",
      schema: { type: "object", properties: { url: { type: "string" }, profile: { type: "string" } } },
      handler: async (a) => {
        const tabId = await deps.openTab(str(a, "url") ?? "", str(a, "profile"));
        deps.foreground(); // 浮出给用户看
        return { tabId };
      },
    },
    {
      name: "profiles",
      description: "列出账号(profile)——各账号 cookie/storage 隔离;new_tab/automation_run 可按 id 指定",
      schema: { type: "object", properties: {} },
      handler: async () => ({ profiles: await deps.listProfiles() }),
    },
    {
      name: "navigate",
      description: "在当前活动标签打开 URL",
      schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
      handler: async (a) => {
        const url = str(a, "url");
        if (!url) throw new Error("navigate 需要 url");
        const w = h();
        deps.foreground(); // 浮出浏览器,让用户看着 agent 导航
        await w.navigate(url); // driver 已内含 ERR_ABORTED 容错
        return { ok: true }; // 地址/标题由 chrome 工具栏经 did-navigate 事件更新
      },
    },
    {
      name: "snapshot",
      description:
        "页面可交互元素快照(DOM):每个元素带稳定唯一 sel(优先 #id→data-*id*→[name]/[aria-label]→a[href]→结构路径)," +
        "可直接把 sel 传给 click/type/get_text。仅可见可交互元素,max 封顶(默认 200)省 token",
      schema: { type: "object", properties: { max: { type: "number" } } },
      handler: async (a) => js(`(${SNAPSHOT_FN})(${num(a, "max") ?? 200})`),
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
      description: "截取当前页面,作为图片返回(缩放到≤1024宽的 JPEG,省 token)",
      schema: { type: "object", properties: {} },
      handler: async () => {
        // driver screenshot 已缩放成 ≤1024 宽的 JPEG(省 token);门面据 mimeType 映射成 MCP image 内容。
        return { mimeType: "image/jpeg", data: Buffer.from(await h().screenshot()).toString("base64") };
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
    // --- CDP 系(经 webContents.debugger 合成可信输入) ---
    {
      name: "click",
      description: "点击元素(selector 或 text 匹配,CDP 合成可信点击)",
      schema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } },
      handler: async (a) => {
        const c = await findElement(h(), { selector: str(a, "selector"), text: str(a, "text") });
        await click(h(), c.x, c.y);
        return { ok: true };
      },
    },
    {
      name: "type",
      description: "在元素中输入文字(text_to_find/selector 定位并聚焦后人性化输入 text)",
      schema: {
        type: "object",
        required: ["text"],
        properties: { selector: { type: "string" }, text: { type: "string" }, text_to_find: { type: "string" } },
      },
      handler: async (a) => {
        const text = str(a, "text");
        if (text == null) throw new Error("type 需要 text");
        const sel = str(a, "selector");
        const find = str(a, "text_to_find");
        if (sel || find) {
          const c = await findElement(h(), { selector: sel, text: find });
          await click(h(), c.x, c.y); // 聚焦
        }
        await typeText(h(), text);
        return { ok: true };
      },
    },
    {
      name: "upload",
      description: "把文件注入文件输入框(selector 指向 input[type=file])",
      schema: {
        type: "object",
        required: ["selector", "filePaths"],
        properties: { selector: { type: "string" }, filePaths: { type: "array", items: { type: "string" } } },
      },
      handler: async (a) => {
        const sel = str(a, "selector");
        if (!sel) throw new Error("upload 需要 selector");
        await setInputFiles(h(), sel, strArr(a, "filePaths"));
        return { ok: true };
      },
    },
    {
      name: "intercept_next",
      description: "等待并拦截下一个匹配 urlPattern(支持 * 通配)的 HTTP 响应,返回 body/headers/status",
      schema: {
        type: "object",
        required: ["urlPattern"],
        properties: { urlPattern: { type: "string" }, timeout: { type: "number" } },
      },
      handler: async (a) => {
        const pat = str(a, "urlPattern");
        if (!pat) throw new Error("intercept_next 需要 urlPattern");
        return interceptNext(h(), pat, num(a, "timeout") ?? 30000);
      },
    },
  ];
}
