// 脚本变量解析与运行上下文构造(港 openclaw automation/vars.ts)。
import type { ContextSetupEntry } from "./script-types.js";

/** 把对象里所有 {{key}} 占位按 vars 替换。整串 "{{k}}" 替成 k 的 JSON 值(对象/数组保形),
 *  嵌在字符串中的 {{k}} 替成其字符串形。 */
export function resolveVariables<T>(obj: T, vars: Record<string, unknown>): T {
  let str = JSON.stringify(obj);
  str = str.replace(/"\{\{(\w+)\}\}"/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return '""';
    return typeof v === "object" ? JSON.stringify(v) : JSON.stringify(String(v));
  });
  str = str.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return JSON.stringify(String(v)).slice(1, -1);
  });
  return JSON.parse(str) as T;
}

function cmp(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    default:
      return false;
  }
}

/** 由 contextSetup + 变量构造运行上下文:number 归一、derived 按比较算布尔(step.when 据此跳过)。 */
export function buildContext(
  setup: Record<string, ContextSetupEntry> | undefined,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { ...vars };
  if (!setup) return ctx;
  for (const [key, e] of Object.entries(setup)) {
    if (e.type === "number") {
      const v = Number(vars[key]);
      ctx[key] = Number.isFinite(v) ? v : (e.default ?? 0);
    } else if (e.type === "derived" && e.source && e.op) {
      if (e.op === "==" || e.op === "!==") {
        const eq = String(ctx[e.source]) === String(e.value);
        ctx[key] = e.op === "==" ? eq : !eq;
      } else {
        ctx[key] = cmp(Number(ctx[e.source]), e.op, Number(e.value));
      }
    }
  }
  return ctx;
}
