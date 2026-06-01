// JSON 路径取值与抽行(港 openclaw automation/jsonpath.ts)。
// path 用 . 分层、[] 标记数组锚点;valueKey 把一条响应抽成多行记录。
import type { ValueKeySpec } from "./script-types.js";

export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[\]/g, "").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    cur = (cur as Record<string, unknown>)?.[p];
    if (cur == null) return undefined;
  }
  return cur;
}

/** "search::replace" 形式的正则替换;无 :: 原样返回。 */
export function applyReg(value: string, reg: string): string {
  const idx = reg.indexOf("::");
  if (idx < 0) return value;
  const search = reg.slice(0, idx);
  const replace = reg.slice(idx + 2);
  try {
    return value.replace(new RegExp(search), replace);
  } catch {
    return value;
  }
}

function resolveList(obj: unknown, path: string): { list: unknown[]; headPrefix: string } | null {
  const at = path.indexOf("[]");
  if (at < 0) return null;
  const headPath = path.slice(0, at).replace(/\.$/, "");
  const headPrefix = path.slice(0, at + 2);
  const arr = headPath ? getByPath(obj, headPath) : obj;
  return Array.isArray(arr) ? { list: arr, headPrefix } : null;
}

function pickField(item: unknown, restPath: string, spec: ValueKeySpec): unknown {
  if (restPath.includes("[]")) {
    const sub = resolveList(item, restPath);
    if (!sub) return spec.type === "array" ? [] : undefined;
    const after = restPath.slice(sub.headPrefix.length).replace(/^\./, "");
    const vals = sub.list.map((s) => (after ? getByPath(s, after) : s));
    if (spec.type === "array") return spec.reg ? vals.map((x) => applyReg(String(x), spec.reg!)) : vals;
    let first = vals[0];
    if (first != null && spec.reg) first = applyReg(String(first), spec.reg);
    return first;
  }
  let v = restPath ? getByPath(item, restPath) : item;
  if (spec.type === "array") {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    return spec.reg ? arr.map((x) => applyReg(String(x), spec.reg!)) : arr;
  }
  if (Array.isArray(v)) v = v[0];
  if (v != null && spec.reg) v = applyReg(String(v), spec.reg);
  return v;
}

/** 把一条响应按 valueKey 抽成记录数组(有 [] 锚点则按该数组逐项展开,否则单行)。 */
export function extractRows(resp: unknown, valueKeys: ValueKeySpec[]): Record<string, unknown>[] {
  const anchor = valueKeys.find((k) => k.path.includes("[]"));
  if (!anchor) {
    const row: Record<string, unknown> = {};
    for (const k of valueKeys) row[k.name] = getByPath(resp, k.path);
    return [row];
  }
  const resolved = resolveList(resp, anchor.path);
  if (!resolved) return [];
  const { list, headPrefix } = resolved;
  return list.map((item) => {
    const row: Record<string, unknown> = {};
    for (const k of valueKeys) {
      if (k.path.startsWith(headPrefix)) {
        const rest = k.path.slice(headPrefix.length).replace(/^\./, "");
        row[k.name] = pickField(item, rest, k);
      } else {
        row[k.name] = getByPath(resp, k.path);
      }
    }
    return row;
  });
}

export function readHasNext(resp: unknown, key: string): boolean {
  const v = getByPath(resp, key);
  if (v === false || v === "false") return false;
  if (v === true || v === "true") return true;
  return Boolean(v);
}
