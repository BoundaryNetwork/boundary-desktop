import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeOutputs } from "./saver.js";
import type { AutomationScript, RunRecord } from "./script-types.js";

/** runScript 的返回形态:context(extract/execute 产物)+ sessions(各 sessionKey 抽到的行)。 */
interface RunOutput {
  context: Record<string, unknown>;
  sessions: Record<string, Record<string, unknown>[]>;
}

/** 串行 run 队列 + runId 取件号 + run 记录,并把产物落盘(session capture):完成即写
 *  <dataDir>/<runId>.json,构造时回载历史 run —— automation_runs/result 跨会话可读。
 *  一次只跑一个 run(共用一个活动标签,避免互踩)。 */
export class Runner {
  #seq = 0;
  #chain: Promise<unknown> = Promise.resolve();
  #runs = new Map<string, RunRecord>();
  #dir: string;

  constructor(dataDir: string) {
    this.#dir = dataDir;
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      // 目录创建失败(权限等):落盘静默退化,run 仍在内存可用
    }
    this.#load();
  }

  dataDir(): string {
    return this.#dir;
  }

  /** 入队一个 run(排在前序之后串行执行)。返回记录与完成 promise(完成态写回记录 + 落盘)。 */
  enqueue(
    script: AutomationScript,
    variables: Record<string, unknown>,
    exec: (rec: RunRecord) => Promise<RunOutput>,
  ): { record: RunRecord; done: Promise<void> } {
    const runId = String(++this.#seq);
    const record: RunRecord = {
      runId,
      scriptId: script.id,
      variables,
      startedAt: new Date().toISOString(),
      status: "queued",
      step: 0,
      total: script.steps.length,
    };
    this.#runs.set(runId, record);
    const done = this.#chain.then(async () => {
      record.status = "running";
      try {
        const out = await exec(record);
        record.output = out;
        record.sessions = Object.fromEntries(
          Object.entries(out.sessions ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
        );
        // outputSchema.csv 把采集结果写成 csv 落 <dataDir>/<runId>/<type>.csv。
        if (script.outputSchema?.csv?.length) {
          const runDir = join(this.#dir, runId);
          try {
            mkdirSync(runDir, { recursive: true });
          } catch {
            // 目录创建失败:csv 落盘静默退化,内存/记录仍可用
          }
          record.outputFiles = writeOutputs(script.outputSchema, out.sessions ?? {}, out.context ?? {}, runDir);
        }
        record.status = "done";
      } catch (e) {
        record.status = "error";
        record.message = e instanceof Error ? e.message : String(e);
      }
      record.finishedAt = new Date().toISOString();
      this.#persist(record);
    });
    this.#chain = done.catch(() => {});
    return { record, done };
  }

  get(runId: string): RunRecord | undefined {
    return this.#runs.get(runId);
  }
  list(): RunRecord[] {
    return [...this.#runs.values()];
  }

  #persist(r: RunRecord): void {
    try {
      const file = join(this.#dir, `${r.runId}.json`);
      r.outputFile = file;
      writeFileSync(file, JSON.stringify(r, null, 2));
    } catch {
      // 落盘失败不影响内存中 run 的可用性
    }
  }

  #load(): void {
    let files: string[];
    try {
      files = readdirSync(this.#dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(this.#dir, f), "utf8")) as RunRecord;
        this.#runs.set(r.runId, r);
        const n = Number(r.runId);
        if (Number.isFinite(n) && n > this.#seq) this.#seq = n; // runId 续号,避免跨会话碰撞
      } catch {
        // 跳过损坏的 run 文件
      }
    }
  }
}
