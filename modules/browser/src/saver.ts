// 采集结果输出(港 openclaw automation/saver.ts):按 outputSchema.csv 把 session/context
// 数据写成 csv 文件,返回写出的文件路径。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getByPath } from "./jsonpath.js";
import type { OutputCsvSpec, OutputSchema } from "./script-types.js";

function csvCell(v: unknown, joinWith?: string): string {
  let s: string;
  if (Array.isArray(v)) s = v.join(joinWith ?? ",");
  else s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: Record<string, unknown>[], columns: OutputCsvSpec["columns"]): string {
  const header = columns.map((c) => csvCell(c.name)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.from], c.joinWith)).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

/** 按 schema.csv 把数据写成 <runDir>/<type>.csv,返回文件绝对路径列表。 */
export function writeOutputs(
  schema: OutputSchema | undefined,
  sessions: Record<string, Record<string, unknown>[]>,
  context: Record<string, unknown>,
  runDir: string,
): string[] {
  const files: string[] = [];
  for (const spec of schema?.csv ?? []) {
    const base = sessions[spec.source] ?? context[spec.source];
    let rows: Record<string, unknown>[];
    if (Array.isArray(base)) {
      rows = base as Record<string, unknown>[];
    } else if (spec.rowsFrom && base != null) {
      const nested = getByPath(base, spec.rowsFrom);
      rows = Array.isArray(nested) ? (nested as Record<string, unknown>[]) : [];
    } else {
      rows = [];
    }
    const p = join(runDir, `${spec.type}.csv`);
    try {
      writeFileSync(p, rowsToCsv(rows, spec.columns));
      files.push(p);
    } catch {
      // 落盘失败跳过该文件,不阻断其余输出
    }
  }
  return files;
}
