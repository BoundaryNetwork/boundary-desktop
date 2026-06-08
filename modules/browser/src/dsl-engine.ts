// 自动化 DSL 引擎(港 openclaw automation/dsl-engine + engine,去可视化 overlay)。
// 顺序执行脚本步骤:{{var}} 解析 + contextSetup 上下文 + when 跳过 + retry/postWait/timeoutMode。
// CDP 动作复用 automation.ts 原语。返回累积的运行上下文(含 extract/execute 产物)。
import type { WebviewHandle } from "@boundary-desktop/contract";
import { click, findElement, moveTo, scroll, setInputFiles, typeText, type ElementTarget } from "./automation.js";
import { buildContext, resolveVariables } from "./vars.js";
import { SessionCollector, attachCapture } from "./session-capture.js";
import type { AutomationScript, AutomationStep, SessionSpec } from "./script-types.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export interface EngineDeps {
  active: () => WebviewHandle | null;
  onStep: (i: number) => void;
}

/** 跨步骤的采集态:sessionCapture 建 collector + 挂 Network 拦截,scrollForSession/transform 复用。 */
interface Capture {
  collector: SessionCollector | null;
  detach: (() => void) | null;
}

export interface RunOutput {
  context: Record<string, unknown>;
  sessions: Record<string, Record<string, unknown>[]>;
}

/** 顺序执行脚本步骤,返回 { context(extract/execute 产物), sessions(采集行) }。 */
export async function runScript(
  script: AutomationScript,
  vars: Record<string, unknown>,
  deps: EngineDeps,
): Promise<RunOutput> {
  const ctx = buildContext(script.contextSetup, vars);
  const steps = resolveVariables(script.steps, vars);
  const view = deps.active();
  if (!view) throw new Error("无活动标签");
  const cap: Capture = { collector: null, detach: null };

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (step.when && !ctx[step.when]) continue;
      deps.onStep(i);
      await runStepWithRetry(view, step, ctx, cap);
      const pw = step.postWait ?? [400, 900];
      await sleep(Array.isArray(pw) ? rand(pw[0]!, pw[1]!) : pw);
    }
  } finally {
    cap.detach?.();
  }
  return { context: ctx, sessions: cap.collector ? cap.collector.all() : {} };
}

async function runStepWithRetry(
  view: WebviewHandle,
  step: AutomationStep,
  ctx: Record<string, unknown>,
  cap: Capture,
): Promise<void> {
  const max = step.retry ?? 0;
  let last: Error | undefined;
  for (let i = 0; i <= max; i++) {
    try {
      await exec(view, step, ctx, cap);
      return;
    } catch (err) {
      last = err as Error;
      if (i < max) {
        const d =
          step.retryDelay != null
            ? step.retryDelay
            : step.retryDelayMin != null
              ? rand(step.retryDelayMin, step.retryDelayMax ?? step.retryDelayMin)
              : 2000;
        await sleep(d);
      }
    }
  }
  if (step.timeoutMode === "continue") return;
  throw last;
}

async function exec(view: WebviewHandle, step: AutomationStep, ctx: Record<string, unknown>, cap: Capture): Promise<void> {
  const target = (step.target ?? {}) as ElementTarget;
  switch (step.action) {
    case "wait": {
      const [a, b] = step.duration ?? [400, 900];
      await sleep(rand(a!, b!));
      return;
    }
    case "navigate":
      await view.navigate(String(step.value ?? "")); // driver 已内含 ERR_ABORTED 容错
      return;
    case "click": {
      const c = await findElement(view, target);
      await click(view, c.x, c.y);
      return;
    }
    case "type": {
      if (!step.noClick && (target.selector || target.text)) {
        const c = await findElement(view, target);
        await click(view, c.x, c.y); // 聚焦
      }
      await typeText(view, String(step.value ?? ""));
      return;
    }
    case "hover": {
      const c = await findElement(view, target);
      await moveTo(view, c.x, c.y);
      return;
    }
    case "scroll": {
      if (target.selector || target.text) {
        await scrollToElement(view, target);
      } else {
        const dy = Number((step.params as { deltaY?: unknown } | undefined)?.deltaY ?? step.value ?? 600);
        await scrollBy(view, Number.isFinite(dy) ? dy : 600);
      }
      return;
    }
    case "upload": {
      const files = (Array.isArray(step.value) ? step.value : [step.value]).filter(Boolean) as string[];
      if (step.inputSelector) {
        await setInputFiles(view, step.inputSelector, files); // 隐藏 input:DataTransfer 注入
      } else {
        // 可见触发器:点击打开系统文件框 + CDP 注入文件
        const t = (step.target ?? step.trigger ?? {}) as ElementTarget;
        await uploadViaChooser(view, t, files);
      }
      return;
    }
    case "waitForElement":
    case "waitForSelector":
      await waitForElement(view, target, step.timeout ?? 30000);
      return;
    case "waitForNavigation":
      await waitForNavigation(view, step.timeout ?? 30000);
      return;
    case "waitForLoad":
      await waitForLoad(view, step.timeout ?? 30000);
      return;
    case "reload":
      await reload(view, step.timeout ?? 30000);
      return;
    case "execute": {
      const fn = String((step.params as { fn?: string } | undefined)?.fn ?? "");
      const saveAs = (step.params as { saveAs?: string } | undefined)?.saveAs;
      const result = await evalInPage(view, `(${fn})(${JSON.stringify(ctx)})`);
      if (saveAs) ctx[`execute_${saveAs}`] = result;
      return;
    }
    case "assertPageState":
      await assertPageState(view, step);
      return;
    case "extract": {
      const spec = (step.value ?? {}) as { key?: string; attr?: string };
      const sel = target.selector ?? "";
      const code = spec.attr
        ? `document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(spec.attr)}) ?? null`
        : `document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`;
      ctx[spec.key ?? "value"] = await view.eval(code);
      return;
    }
    case "sessionCapture": {
      const p = (step.params ?? {}) as Record<string, unknown>;
      let specs: SessionSpec[] = Array.isArray(p.sessionList)
        ? (p.sessionList as SessionSpec[])
        : [p as unknown as SessionSpec];
      specs = specs.filter((s) => !s.when || ctx[s.when]);
      cap.detach?.(); // 重复 sessionCapture 先解绑前次
      cap.collector = new SessionCollector(specs);
      cap.detach = attachCapture(view, cap.collector);
      return;
    }
    case "scrollForSession": {
      if (!cap.collector) return;
      const p = (step.params ?? {}) as {
        sessionKey: string;
        limitTotal?: number | string;
        scrollStep?: number;
        limitScroll?: number;
      };
      const limitTotal = p.limitTotal != null ? Number(p.limitTotal) : Infinity;
      const maxScrolls = p.limitScroll ?? 50;
      const baseStep = p.scrollStep ?? 800;
      cap.collector.setCap(p.sessionKey, limitTotal); // 先设上限,迟到响应也被挡住
      for (let i = 0; i < maxScrolls; i++) {
        const thisStep = Math.round(baseStep * (0.7 + rand(0, 0.6)));
        await scrollBy(view, thisStep, target);
        await sleep(rand(1600, 3600)); // 放慢节奏避免风控
        if (rand(0, 1) < 0.25) await sleep(1000 + rand(300, 600));
        if (cap.collector.count(p.sessionKey) >= limitTotal || !cap.collector.hasNext(p.sessionKey)) break;
      }
      return;
    }
    case "transform": {
      const p = (step.params ?? {}) as { input?: { sessionKey?: string }; fn: string; saveAs?: string };
      const data = p.input?.sessionKey && cap.collector ? cap.collector.values(p.input.sessionKey) : ctx;
      // new Function 仅执行内置可信脚本(随模块打包,非用户输入)
      const fn = new Function("input", "context", `return (${p.fn})(input, context)`);
      const result = fn(data, ctx);
      if (p.saveAs) ctx[`execute_${p.saveAs}`] = result;
      return;
    }
    default:
      throw new Error(`action 未实现: ${(step as AutomationStep).action}`);
  }
}

// --- 引擎原语(WebviewHandle 事件驱动,非 CDP) ---

/** 按 deltaY 滚一次:有 target 在其坐标处滚,否则在视口中心滚(港 engine.scroll)。 */
async function scrollBy(view: WebviewHandle, deltaY: number, target?: ElementTarget): Promise<void> {
  if (target && (target.selector || target.text)) {
    const c = await findElement(view, target, false);
    await scroll(view, c.x, c.y, deltaY);
  } else {
    const { w, h } = await viewport(view);
    await scroll(view, Math.round(w / 2), Math.round(h / 2), deltaY);
  }
}

async function viewport(view: WebviewHandle): Promise<{ w: number; h: number }> {
  try {
    const v = await view.eval<{ w: number; h: number }>("({w:window.innerWidth,h:window.innerHeight})");
    return { w: v.w || 1000, h: v.h || 800 };
  } catch {
    return { w: 1000, h: 800 };
  }
}

async function waitForElement(view: WebviewHandle, target: ElementTarget, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      await findElement(view, target, false);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`等待元素超时: ${JSON.stringify(target)}`);
      await sleep(300);
    }
  }
}

/** 等真实页面导航(整页或 SPA history)。超时 reject。 */
function waitForNavigation(view: WebviewHandle, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const subs = [view.on("did-navigate", on), view.on("did-navigate-in-page", on)];
    function off(): void {
      for (const s of subs) s.dispose();
    }
    function on(): void {
      clearTimeout(timer);
      off();
      resolve();
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待页面导航超时"));
    }, timeout);
  });
}

/** 等页面加载就绪:已 interactive/complete 直接放行,否则事件监听(规避错过事件干等)。 */
async function waitForLoad(view: WebviewHandle, timeout: number): Promise<void> {
  try {
    const rs = await view.eval("document.readyState");
    if (rs === "complete" || rs === "interactive") return;
  } catch {
    // 上下文尚不可用,回退事件监听
  }
  return new Promise((resolve, reject) => {
    const subs = [view.on("did-navigate", on), view.on("did-navigate-in-page", on), view.on("did-finish-load", on)];
    function off(): void {
      for (const s of subs) s.dispose();
    }
    function on(): void {
      clearTimeout(timer);
      off();
      resolve();
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待页面加载超时"));
    }, timeout);
  });
}

/** 刷新当前页并等完成:先挂监听再 reload,原子化规避刷新竞态。 */
function reload(view: WebviewHandle, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const subs = [view.on("did-navigate", on), view.on("did-navigate-in-page", on), view.on("did-finish-load", on)];
    function off(): void {
      for (const s of subs) s.dispose();
    }
    function on(): void {
      clearTimeout(timer);
      off();
      resolve();
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error("刷新等待超时"));
    }, timeout);
    try {
      view.reload();
    } catch (err) {
      clearTimeout(timer);
      off();
      reject(err as Error);
    }
  });
}

/** 人类化把目标元素滚进可视区(分段滚轮、每段重定位 + 停顿),可点即停(港 engine.scrollToElement)。 */
async function scrollToElement(view: WebviewHandle, target: ElementTarget): Promise<void> {
  const { w, h } = await viewport(view);
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const margin = 8;
  let notFound = 0;
  let lastY: number | null = null;
  for (let i = 0; i < 25; i++) {
    let coords: { y: number; height: number };
    try {
      coords = await findElement(view, target, false);
    } catch {
      if (++notFound > 15) return; // 多半懒加载,盲滚再找;连续多次仍无则放弃
      await scroll(view, cx, cy, Math.round(rand(280, 440)));
      await sleep(rand(500, 1300));
      continue;
    }
    notFound = 0;
    const half = coords.height / 2;
    if (coords.y - half >= margin && coords.y + half <= h - margin) return; // 完整在视口内
    if (lastY != null && Math.abs(coords.y - lastY) < 4) return; // 到底/到顶,位置不再变
    lastY = coords.y;
    const cap = rand(300, 440);
    const stepDelta = Math.max(-cap, Math.min(cap, coords.y - cy));
    await scroll(view, cx, cy, Math.round(stepDelta));
    await sleep(rand(500, 1300));
  }
}

/** 点击可见触发器打开系统文件框,经 CDP 拦截 Page.fileChooserOpened 并注入文件(港 uploader.uploadFiles)。 */
async function uploadViaChooser(view: WebviewHandle, target: ElementTarget, filePaths: string[]): Promise<void> {
  if (!filePaths.length) return;
  const c = await findElement(view, target);
  await view.cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const handled = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      void view.cdp.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
      reject(new Error("文件选择框拦截超时(15s)"));
    }, 15000);
    const sub = view.cdp.on("Page.fileChooserOpened", () => {
      sub.dispose();
      clearTimeout(timer);
      void view.cdp
        .send("Page.handleFileChooser", { action: "accept", files: filePaths })
        .then(() => view.cdp.send("Page.setInterceptFileChooserDialog", { enabled: false }))
        .then(() => sleep(800))
        .then(resolve, reject);
    });
  });
  await click(view, c.x, c.y); // 触发文件框
  await handled;
}

/** 在页内 eval(支持 await),经 driver eval 返回值(异常已在 driver eval 内转抛)。 */
async function evalInPage(view: WebviewHandle, js: string): Promise<unknown> {
  return view.eval(js);
}

/** 轮询 failWhen 条件:窗口内出现过"非失败态"即通过;持续失败到超时才判失败(港 assertPageState)。 */
async function assertPageState(view: WebviewHandle, step: AutomationStep): Promise<void> {
  const p = (step.params ?? {}) as {
    failWhen?: Array<{ type: "url" | "exist" | "text"; value?: string; includes?: string; selector?: string }>;
    errorCode?: string;
    errorMessage?: string;
    timeout?: number;
  };
  const failWhen = p.failWhen ?? [];
  const timeout = step.timeout ?? p.timeout ?? 10000;
  const deadline = Date.now() + timeout;
  const condJs = (c: { type: string; value?: string; includes?: string; selector?: string }): string => {
    if (c.type === "url") return `location.href.includes(${JSON.stringify(c.value ?? c.includes ?? "")})`;
    if (c.type === "exist") return `!!document.querySelector(${JSON.stringify(c.selector ?? "")})`;
    return `document.body.innerText.includes(${JSON.stringify(c.value ?? "")})`;
  };
  let everClear = false;
  let lastHit = false;
  while (Date.now() < deadline) {
    let anyHit = false;
    let evalFailed = false;
    for (const c of failWhen) {
      try {
        if (await view.eval(condJs(c))) {
          anyHit = true;
          break;
        }
      } catch {
        evalFailed = true;
        break;
      }
    }
    if (evalFailed) {
      await sleep(500);
      continue;
    }
    if (!anyHit) {
      everClear = true;
      break;
    }
    lastHit = true;
    await sleep(500);
  }
  if (everClear) return;
  if (lastHit) {
    const e = new Error(p.errorMessage ?? "页面状态断言失败");
    (e as unknown as Record<string, unknown>).errorCode = p.errorCode ?? "ASSERTION_FAILED";
    throw e;
  }
}
