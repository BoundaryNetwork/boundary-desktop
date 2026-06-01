// 自动化 DSL 引擎(港 openclaw automation/dsl-engine + engine,去可视化 overlay)。
// 顺序执行脚本步骤:{{var}} 解析 + contextSetup 上下文 + when 跳过 + retry/postWait/timeoutMode。
// CDP 动作复用 automation.ts 原语。返回累积的运行上下文(含 extract/execute 产物)。
import type { WebContents } from "electron";
import { click, findElement, moveTo, scroll, setInputFiles, typeText, type ElementTarget } from "./automation.js";
import { buildContext, resolveVariables } from "./vars.js";
import type { AutomationScript, AutomationStep } from "./script-types.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export interface EngineDeps {
  active: () => WebContents | null;
  onStep: (i: number) => void;
}

/** 顺序执行脚本步骤,返回累积上下文。 */
export async function runScript(
  script: AutomationScript,
  vars: Record<string, unknown>,
  deps: EngineDeps,
): Promise<Record<string, unknown>> {
  const ctx = buildContext(script.contextSetup, vars);
  const steps = resolveVariables(script.steps, vars);
  const wc = deps.active();
  if (!wc || wc.isDestroyed()) throw new Error("无活动标签");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.when && !ctx[step.when]) continue;
    deps.onStep(i);
    await runStepWithRetry(wc, step, ctx);
    const pw = step.postWait ?? [400, 900];
    await sleep(Array.isArray(pw) ? rand(pw[0]!, pw[1]!) : pw);
  }
  return ctx;
}

async function runStepWithRetry(wc: WebContents, step: AutomationStep, ctx: Record<string, unknown>): Promise<void> {
  const max = step.retry ?? 0;
  let last: Error | undefined;
  for (let i = 0; i <= max; i++) {
    try {
      await exec(wc, step, ctx);
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

async function exec(wc: WebContents, step: AutomationStep, ctx: Record<string, unknown>): Promise<void> {
  const target = (step.target ?? {}) as ElementTarget;
  switch (step.action) {
    case "wait": {
      const [a, b] = step.duration ?? [400, 900];
      await sleep(rand(a!, b!));
      return;
    }
    case "navigate":
      await wc.loadURL(String(step.value ?? "")).catch((e: unknown) => {
        if (!String(e).includes("ERR_ABORTED")) throw e; // 重定向取消属正常
      });
      return;
    case "click": {
      const c = await findElement(wc, target);
      await click(wc, c.x, c.y);
      return;
    }
    case "type": {
      if (!step.noClick && (target.selector || target.text)) {
        const c = await findElement(wc, target);
        await click(wc, c.x, c.y); // 聚焦
      }
      await typeText(wc, String(step.value ?? ""));
      return;
    }
    case "hover": {
      const c = await findElement(wc, target);
      await moveTo(wc, c.x, c.y);
      return;
    }
    case "scroll": {
      if (target.selector || target.text) {
        await scrollToElement(wc, target);
      } else {
        const dy = Number((step.params as { deltaY?: unknown } | undefined)?.deltaY ?? step.value ?? 600);
        const { w, h } = await viewport(wc);
        await scroll(wc, Math.round(w / 2), Math.round(h / 2), Number.isFinite(dy) ? dy : 600);
      }
      return;
    }
    case "upload": {
      const files = (Array.isArray(step.value) ? step.value : [step.value]).filter(Boolean) as string[];
      if (step.inputSelector) {
        await setInputFiles(wc, step.inputSelector, files); // 隐藏 input:DataTransfer 注入
      } else {
        // 可见触发器:点击打开系统文件框 + CDP 注入文件
        const t = (step.target ?? step.trigger ?? {}) as ElementTarget;
        await uploadViaChooser(wc, t, files);
      }
      return;
    }
    case "waitForElement":
    case "waitForSelector":
      await waitForElement(wc, target, step.timeout ?? 30000);
      return;
    case "waitForNavigation":
      await waitForNavigation(wc, step.timeout ?? 30000);
      return;
    case "waitForLoad":
      await waitForLoad(wc, step.timeout ?? 30000);
      return;
    case "reload":
      await reload(wc, step.timeout ?? 30000);
      return;
    case "execute": {
      const fn = String((step.params as { fn?: string } | undefined)?.fn ?? "");
      const saveAs = (step.params as { saveAs?: string } | undefined)?.saveAs;
      const result = await evalInPage(wc, `(${fn})(${JSON.stringify(ctx)})`);
      if (saveAs) ctx[`execute_${saveAs}`] = result;
      return;
    }
    case "assertPageState":
      await assertPageState(wc, step);
      return;
    case "extract": {
      const spec = (step.value ?? {}) as { key?: string; attr?: string };
      const sel = target.selector ?? "";
      const code = spec.attr
        ? `document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(spec.attr)}) ?? null`
        : `document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`;
      ctx[spec.key ?? "value"] = await wc.executeJavaScript(code);
      return;
    }
    default:
      throw new Error(`action 未实现: ${(step as AutomationStep).action}`);
  }
}

// --- 引擎原语(webContents 事件驱动,非 CDP) ---

async function viewport(wc: WebContents): Promise<{ w: number; h: number }> {
  try {
    const v = (await wc.executeJavaScript("({w:window.innerWidth,h:window.innerHeight})")) as { w: number; h: number };
    return { w: v.w || 1000, h: v.h || 800 };
  } catch {
    return { w: 1000, h: 800 };
  }
}

async function waitForElement(wc: WebContents, target: ElementTarget, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      await findElement(wc, target, false);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`等待元素超时: ${JSON.stringify(target)}`);
      await sleep(300);
    }
  }
}

/** 等真实页面导航(整页或 SPA history)。超时 reject。 */
function waitForNavigation(wc: WebContents, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = (): void => {
      wc.removeListener("did-navigate", on);
      wc.removeListener("did-navigate-in-page", on);
    };
    const on = (): void => {
      clearTimeout(timer);
      off();
      resolve();
    };
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待页面导航超时"));
    }, timeout);
    wc.on("did-navigate", on);
    wc.on("did-navigate-in-page", on);
  });
}

/** 等页面加载就绪:已 interactive/complete 直接放行,否则事件监听(规避错过事件干等)。 */
async function waitForLoad(wc: WebContents, timeout: number): Promise<void> {
  try {
    const rs = await wc.executeJavaScript("document.readyState");
    if (rs === "complete" || rs === "interactive") return;
  } catch {
    // 上下文尚不可用,回退事件监听
  }
  return new Promise((resolve, reject) => {
    const off = (): void => {
      wc.removeListener("did-navigate", on);
      wc.removeListener("did-navigate-in-page", on);
      wc.removeListener("did-finish-load", on);
    };
    const on = (): void => {
      clearTimeout(timer);
      off();
      resolve();
    };
    const timer = setTimeout(() => {
      off();
      reject(new Error("等待页面加载超时"));
    }, timeout);
    wc.on("did-navigate", on);
    wc.on("did-navigate-in-page", on);
    wc.on("did-finish-load", on);
  });
}

/** 刷新当前页并等完成:先挂监听再 reload,原子化规避刷新竞态。 */
function reload(wc: WebContents, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = (): void => {
      wc.removeListener("did-navigate", on);
      wc.removeListener("did-navigate-in-page", on);
      wc.removeListener("did-finish-load", on);
    };
    const on = (): void => {
      clearTimeout(timer);
      off();
      resolve();
    };
    const timer = setTimeout(() => {
      off();
      reject(new Error("刷新等待超时"));
    }, timeout);
    wc.on("did-navigate", on);
    wc.on("did-navigate-in-page", on);
    wc.on("did-finish-load", on);
    try {
      wc.reload();
    } catch (err) {
      clearTimeout(timer);
      off();
      reject(err as Error);
    }
  });
}

/** 人类化把目标元素滚进可视区(分段滚轮、每段重定位 + 停顿),可点即停(港 engine.scrollToElement)。 */
async function scrollToElement(wc: WebContents, target: ElementTarget): Promise<void> {
  const { w, h } = await viewport(wc);
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const margin = 8;
  let notFound = 0;
  let lastY: number | null = null;
  for (let i = 0; i < 25; i++) {
    let coords: { y: number; height: number };
    try {
      coords = await findElement(wc, target, false);
    } catch {
      if (++notFound > 15) return; // 多半懒加载,盲滚再找;连续多次仍无则放弃
      await scroll(wc, cx, cy, Math.round(rand(280, 440)));
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
    await scroll(wc, cx, cy, Math.round(stepDelta));
    await sleep(rand(500, 1300));
  }
}

/** 点击可见触发器打开系统文件框,经 CDP 拦截 Page.fileChooserOpened 并注入文件(港 uploader.uploadFiles)。 */
async function uploadViaChooser(wc: WebContents, target: ElementTarget, filePaths: string[]): Promise<void> {
  if (!filePaths.length) return;
  const c = await findElement(wc, target);
  await wc.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
  const handled = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      wc.debugger.removeListener("message", onMsg);
      void wc.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
      reject(new Error("文件选择框拦截超时(15s)"));
    }, 15000);
    const onMsg = (_e: unknown, method: string): void => {
      if (method !== "Page.fileChooserOpened") return;
      wc.debugger.removeListener("message", onMsg);
      clearTimeout(timer);
      void wc.debugger
        .sendCommand("Page.handleFileChooser", { action: "accept", files: filePaths })
        .then(() => wc.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }))
        .then(() => sleep(800))
        .then(resolve, reject);
    };
    wc.debugger.on("message", onMsg);
  });
  await click(wc, c.x, c.y); // 触发文件框
  await handled;
}

/** 在页内 eval(支持 await),经 CDP 返回值。 */
async function evalInPage(wc: WebContents, js: string): Promise<unknown> {
  const r = (await wc.debugger.sendCommand("Runtime.evaluate", {
    expression: `(async function(){ return (${js}); })()`,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  if (r.exceptionDetails) throw new Error(`execute 出错: ${r.exceptionDetails.text ?? ""}`);
  return r.result?.value;
}

/** 轮询 failWhen 条件:窗口内出现过"非失败态"即通过;持续失败到超时才判失败(港 assertPageState)。 */
async function assertPageState(wc: WebContents, step: AutomationStep): Promise<void> {
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
        if (await wc.executeJavaScript(condJs(c))) {
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
