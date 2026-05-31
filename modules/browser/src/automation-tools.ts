import type { ToolDefinition } from "@boundary-desktop/contract";
import type { WebContents } from "electron";
import { runScript } from "./dsl-engine.js";
import { loadScripts } from "./script-loader.js";
import type { Runner } from "./runner.js";
import type { RunRecord } from "./script-types.js";

const SYNC_WINDOW = 55_000; // ≤55s 完成则同步返结果,否则返 runId 转轮询(照搬 openclaw 混合模型)

interface Deps {
  scriptsDir: string;
  active: () => WebContents | null;
  runner: Runner;
}

/** 概要:不回全量 output(键名即可),避免把采集数据塞爆调用方上下文。 */
function summary(r: RunRecord): object {
  return {
    runId: r.runId,
    scriptId: r.scriptId,
    status: r.status,
    step: r.step,
    total: r.total,
    outputKeys: r.output ? Object.keys(r.output) : [],
    message: r.message,
  };
}

const str = (a: unknown, k: string): string | undefined => {
  const v = a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" ? v : undefined;
};

/** automation.* 工具(自动加前缀,经门面暴露)。脚本来自模块内置目录,runner 串行执行。 */
export function automationTools(deps: Deps): ToolDefinition[] {
  const requireRun = (a: unknown): RunRecord => {
    const id = str(a, "runId");
    const r = id ? deps.runner.get(id) : undefined;
    if (!r) throw new Error(`无此 runId: ${id ?? ""}`);
    return r;
  };
  return [
    {
      name: "automation_list",
      description: "列出内置自动化脚本及其参数",
      schema: { type: "object", properties: {} },
      handler: async () => {
        const { scripts, skipped } = loadScripts(deps.scriptsDir);
        return {
          scripts: scripts.map((s) => ({ id: s.id, name: s.name, description: s.description, variables: s.variables ?? [] })),
          skipped,
        };
      },
    },
    {
      name: "automation_run",
      description: "运行自动化脚本。≤55s 完成回 summary+output;超时回 runId,后续 automation_status 轮询",
      schema: {
        type: "object",
        required: ["scriptId"],
        properties: { scriptId: { type: "string" }, variables: { type: "object" } },
      },
      handler: async (a) => {
        const args = (a ?? {}) as { scriptId?: string; variables?: Record<string, unknown> };
        const script = loadScripts(deps.scriptsDir).scripts.find((s) => s.id === args.scriptId);
        if (!script) throw new Error(`无脚本: ${args.scriptId ?? ""}`);
        const vars = args.variables ?? {};
        const { record, done } = deps.runner.enqueue(script, vars, (rec) =>
          runScript(script, vars, { active: deps.active, onStep: (i) => (rec.step = i) }),
        );
        const raced = await Promise.race([
          done.then(() => "done" as const),
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), SYNC_WINDOW)),
        ]);
        return raced === "done" ? { ...summary(record), output: record.output } : summary(record);
      },
    },
    {
      name: "automation_status",
      description: "查询 run 状态/概要(轮询用)",
      schema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } },
      handler: async (a) => summary(requireRun(a)),
    },
    {
      name: "automation_result",
      description: "读取 run 的采集结果(全量 output)",
      schema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } },
      handler: async (a) => {
        const r = requireRun(a);
        return { ...summary(r), output: r.output ?? null };
      },
    },
    {
      name: "automation_runs",
      description: "列出历史 run",
      schema: { type: "object", properties: {} },
      handler: async () => deps.runner.list().map(summary),
    },
  ];
}
