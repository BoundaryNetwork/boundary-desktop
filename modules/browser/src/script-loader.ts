import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ACTION_TYPES, type AutomationScript } from "./script-types.js";

const ACTIONS: ReadonlySet<string> = new Set<string>(ACTION_TYPES);

function validate(s: AutomationScript): AutomationScript {
  if (!s.id) throw new Error("脚本缺 id");
  if (!Array.isArray(s.steps) || s.steps.length === 0) throw new Error(`脚本 ${s.id} 缺 steps`);
  for (const [i, st] of s.steps.entries()) {
    if (!ACTIONS.has(st.action)) throw new Error(`脚本 ${s.id} step ${i} 未知 action: ${st.action}`);
  }
  return s;
}

export interface ScriptLoadResult {
  scripts: AutomationScript[];
  /** 加载/校验失败被跳过的脚本(缺 id / JSON 错 / 未知 action),不静默消失。 */
  skipped: { file: string; reason: string }[];
}

/** 读模块内置脚本目录下所有 *.json,逐个 parse+validate。 */
export function loadScripts(dir: string): ScriptLoadResult {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return { scripts: [], skipped: [] };
  }
  const scripts: AutomationScript[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const f of files) {
    try {
      scripts.push(validate(JSON.parse(readFileSync(join(dir, f), "utf8")) as AutomationScript));
    } catch (err) {
      skipped.push({ file: f, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { scripts, skipped };
}
