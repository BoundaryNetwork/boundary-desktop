// CDP 自动化原语(从 openclaw AutomationEngine 平移,去掉调试 overlay / tagMode 等附加项):
// 经 webContents.debugger 发 CDP,合成可信输入(反检测)。供 browser.{click,type,upload,intercept_next} 用。
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { WebContents } from "electron";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export function ensureAttached(wc: WebContents): void {
  try {
    wc.debugger.attach("1.3");
  } catch {
    // 已 attach(同一 webContents 只能挂一个 debugger),忽略
  }
}

export interface ElementTarget {
  selector?: string;
  text?: string;
}
export interface Coords {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** selector / text 定位元素,滚入视野,返回视口内中心坐标 + 尺寸(港 openclaw finder 的页内 JS)。 */
export async function findElement(wc: WebContents, target: ElementTarget, scrollIntoView = true): Promise<Coords> {
  ensureAttached(wc);
  const expr = `(function(){
    var selector=${JSON.stringify(target.selector ?? "")}, text=${JSON.stringify(target.text ?? "")}, el=null;
    if(selector&&text){try{var ns=document.querySelectorAll(selector);for(var j=0;j<ns.length;j++){var t=(ns[j].innerText||ns[j].value||'').trim();if(t===text){el=ns[j];break;}}if(!el){for(var j=0;j<ns.length;j++){var t=(ns[j].innerText||ns[j].value||'').trim();if(t&&t.includes(text)){el=ns[j];break;}}}}catch(e){}}
    else if(selector){try{el=document.querySelector(selector);}catch(e){}}
    if(!el&&text){var cs=document.querySelectorAll('button,a,input,textarea,select,label,[role="button"],[role="tab"],[role="menuitem"],[contenteditable],div,span,p');var ex=null,inc=null;for(var i=0;i<cs.length;i++){var n=cs[i],tt=(n.innerText||n.value||n.placeholder||'').trim();if(tt===text){ex=n;break;}if(!inc&&tt&&tt.includes(text))inc=n;}el=ex||inc;}
    if(!el)return null;
    if(${scrollIntoView ? "true" : "false"}){var r0=el.getBoundingClientRect();if(r0.top<0||r0.bottom>(window.innerHeight||document.documentElement.clientHeight))el.scrollIntoView({block:'center',inline:'nearest'});}
    var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return null;
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:Math.round(r.width),height:Math.round(r.height)};
  })()`;
  const res = (await wc.debugger.sendCommand("Runtime.evaluate", { expression: expr, returnByValue: true })) as {
    result?: { value?: Coords | null };
  };
  const v = res.result?.value;
  if (!v) throw new Error(`未找到元素: selector="${target.selector ?? ""}" text="${target.text ?? ""}"`);
  return v;
}

interface P {
  x: number;
  y: number;
}
function bezier(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const m = 1 - t;
  return {
    x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x,
    y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y,
  };
}
let cursor: P = { x: 100, y: 100 };

export async function moveTo(wc: WebContents, x: number, y: number): Promise<void> {
  ensureAttached(wc);
  const dx = x - cursor.x;
  const dy = y - cursor.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= 2) {
    const steps = Math.max(20, Math.min(80, Math.round(dist / 6)));
    const px = -dy / dist;
    const py = dx / dist;
    const o1 = rand(-0.25, 0.25) * dist;
    const o2 = rand(-0.25, 0.25) * dist;
    const cp1 = { x: cursor.x + dx * 0.25 + px * o1, y: cursor.y + dy * 0.25 + py * o1 };
    const cp2 = { x: cursor.x + dx * 0.75 + px * o2, y: cursor.y + dy * 0.75 + py * o2 };
    const start = cursor;
    const target = { x, y };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const p = bezier(start, cp1, cp2, target, eased);
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(p.x + rand(-1.5, 1.5)),
        y: Math.round(p.y + rand(-1.5, 1.5)),
        modifiers: 0,
      });
      await sleep(rand(8, 16));
    }
  }
  cursor = { x, y };
}

export async function click(wc: WebContents, x: number, y: number): Promise<void> {
  await moveTo(wc, x, y);
  await sleep(rand(60, 150));
  await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers: 0 });
  await sleep(rand(40, 90));
  await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers: 0 });
}

/** 在 (x,y) 处人类化滚轮 deltaY(港 openclaw mouse.scroll,去 overlay):
 *  先把锚点小幅抖动后 moveTo,再分多段加权下发 mouseWheel,放慢节奏避免风控。 */
export async function scroll(wc: WebContents, x: number, y: number, deltaY: number, humanize = true): Promise<void> {
  ensureAttached(wc);
  const jx = Math.round(x + rand(-20, 20));
  const jy = Math.round(y + rand(-20, 20));
  await moveTo(wc, jx, jy);
  if (!humanize) {
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", x: jx, y: jy, deltaX: 0, deltaY, modifiers: 0 });
    return;
  }
  const steps = Math.max(8, Math.min(20, Math.round(Math.abs(deltaY) / 50)));
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const w = Math.pow(1 - i / steps, 1.5) + 0.1;
    weights.push(w);
    sum += w;
  }
  for (let i = 0; i < steps; i++) {
    const stepDelta = Math.round((deltaY * weights[i]!) / sum);
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", x: jx, y: jy, deltaX: 0, deltaY: stepDelta, modifiers: 0 });
    await sleep(rand(40, 110));
  }
}

const NEAR = "abcdefghijklmnopqrstuvwxyz0123456789";

export async function typeText(wc: WebContents, text: string, humanize = true): Promise<void> {
  ensureAttached(wc);
  const insert = (c: string): Promise<unknown> => wc.debugger.sendCommand("Input.insertText", { text: c });
  if (!humanize) {
    await insert(text);
    return;
  }
  for (const ch of text) {
    if (Math.random() < 0.03) {
      await insert(NEAR[Math.floor(Math.random() * NEAR.length)]!);
      await sleep(rand(180, 320));
      await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await sleep(rand(80, 150));
    }
    await insert(ch);
    await sleep(rand(80, 200));
  }
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
};

/** 经 DataTransfer 把文件注入隐藏 file input(兼容 React/Vue,无需触发文件选择框)。 */
export async function setInputFiles(wc: WebContents, selector: string, filePaths: string[]): Promise<void> {
  if (!filePaths.length) return;
  const files = filePaths.map((fp) => ({
    name: basename(fp),
    mimeType: MIME[extname(fp).toLowerCase()] ?? "application/octet-stream",
    base64: readFileSync(fp).toString("base64"),
  }));
  const sel = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const r = (await wc.executeJavaScript(`(async function(){
    var files=${JSON.stringify(files)};var input=document.querySelector('${sel}');if(!input)return {ok:false,error:'未找到 input'};
    var dt=new DataTransfer();for(var k=0;k<files.length;k++){var f=files[k],bin=atob(f.base64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);dt.items.add(new File([u],f.name,{type:f.mimeType}));}
    Object.defineProperty(input,'files',{value:dt.files,writable:false,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('input',{bubbles:true}));return {ok:true};
  })()`)) as { ok: boolean; error?: string };
  if (!r?.ok) throw new Error(`文件注入失败: ${r?.error ?? "未知"}`);
}

/** 等待并拦截下一个匹配 urlPattern(支持 * 通配)的 HTTP 响应,返回 body/headers/status。 */
export async function interceptNext(
  wc: WebContents,
  urlPattern: string,
  timeout = 30000,
): Promise<{ url: string; status: number; headers: Record<string, string>; body: string }> {
  ensureAttached(wc);
  await wc.debugger.sendCommand("Network.enable", {});
  const re = new RegExp("^" + urlPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      wc.debugger.removeListener("message", onMsg);
      reject(new Error(`拦截超时(${timeout}ms): ${urlPattern}`));
    }, timeout);
    const onMsg = (
      _e: unknown,
      method: string,
      params: { requestId?: string; response?: { url: string; status: number; headers: Record<string, string> } },
    ): void => {
      if (method !== "Network.responseReceived" || !params.response || !re.test(params.response.url)) return;
      const { requestId, response } = params as { requestId: string; response: NonNullable<typeof params.response> };
      wc.debugger.removeListener("message", onMsg);
      clearTimeout(timer);
      void wc.debugger
        .sendCommand("Network.getResponseBody", { requestId })
        .then((b) => {
          const body = b as { body: string; base64Encoded: boolean };
          resolve({
            url: response.url,
            status: response.status,
            headers: response.headers,
            body: body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body,
          });
        })
        .catch(reject);
    };
    wc.debugger.on("message", onMsg);
  });
}
