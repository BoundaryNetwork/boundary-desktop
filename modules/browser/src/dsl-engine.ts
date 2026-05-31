import type { WebContents } from "electron";
import { click, findElement, typeText } from "./automation.js";
import type { AutomationScript } from "./script-types.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** {{key}} 插值(仅作用于字符串字段)。 */
function subst(v: unknown, vars: Record<string, unknown>): unknown {
  return typeof v === "string" ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "")) : v;
}

export interface EngineDeps {
  active: () => WebContents | null;
  onStep: (i: number) => void;
}

/** 顺序执行脚本步骤,返回 extract 累积的输出。CDP 动作复用 automation.ts 原语。 */
export async function runScript(
  script: AutomationScript,
  vars: Record<string, unknown>,
  deps: EngineDeps,
): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (let i = 0; i < script.steps.length; i++) {
    deps.onStep(i);
    const st = script.steps[i]!;
    const wc = deps.active();
    if (!wc || wc.isDestroyed()) throw new Error("无活动标签");
    const sel = subst(st.target?.selector, vars) as string | undefined;
    const text = subst(st.target?.text, vars) as string | undefined;
    switch (st.action) {
      case "navigate":
        await wc.loadURL(String(subst(st.value, vars))).catch((e: unknown) => {
          if (!String(e).includes("ERR_ABORTED")) throw e;
        });
        break;
      case "wait":
        await sleep(Number(subst(st.value, vars)) || 0);
        break;
      case "waitForElement":
        await waitFor(wc, sel ?? "", st.timeout ?? 30000);
        break;
      case "click": {
        const c = await findElement(wc, { selector: sel, text });
        await click(wc, c.x, c.y);
        break;
      }
      case "type": {
        if (sel || text) {
          const c = await findElement(wc, { selector: sel, text });
          await click(wc, c.x, c.y); // 聚焦
        }
        await typeText(wc, String(subst(st.value, vars)));
        break;
      }
      case "extract": {
        const spec = (st.value ?? {}) as { key?: string; attr?: string };
        output[spec.key ?? "value"] = await extract(wc, sel ?? "", spec.attr);
        break;
      }
    }
  }
  return output;
}

async function waitFor(wc: WebContents, selector: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  const probe = `!!document.querySelector(${JSON.stringify(selector)})`;
  for (;;) {
    if (await wc.executeJavaScript(probe)) return;
    if (Date.now() >= deadline) throw new Error(`等待元素超时: ${selector}`);
    await sleep(200);
  }
}

function extract(wc: WebContents, selector: string, attr?: string): Promise<unknown> {
  const code = attr
    ? `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attr)}) ?? null`
    : `document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`;
  return wc.executeJavaScript(code);
}
