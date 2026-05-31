import type { AutomationScript, RunRecord } from "./script-types.js";

/** 串行 run 队列 + runId 取件号 + run 记录。一次只跑一个 run(共用一个活动标签,避免互踩)。 */
export class Runner {
  #seq = 0;
  #chain: Promise<unknown> = Promise.resolve();
  #runs = new Map<string, RunRecord>();

  /** 入队一个 run(排在前序之后串行执行)。返回记录与完成 promise(完成态写回记录)。 */
  enqueue(
    script: AutomationScript,
    variables: Record<string, unknown>,
    exec: (rec: RunRecord) => Promise<Record<string, unknown>>,
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
        record.output = await exec(record);
        record.status = "done";
      } catch (e) {
        record.status = "error";
        record.message = e instanceof Error ? e.message : String(e);
      }
      record.finishedAt = new Date().toISOString();
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
}
