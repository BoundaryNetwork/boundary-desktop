// 自动化 DSL 类型(openclaw AutomationScript 的最小核心子集)。
// 完整动作集 / sessionCapture / jsonpath / csv/zip 输出留 Phase 4b。

export interface ScriptVariable {
  key: string;
  label: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
  default?: unknown;
}

export const ACTION_TYPES = ["navigate", "wait", "waitForElement", "click", "type", "extract"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface AutomationStep {
  action: ActionType;
  description?: string;
  target?: { selector?: string; text?: string };
  /** navigate:url;wait:毫秒;type:文本;extract:{key,attr?}。字符串字段支持 {{var}} 插值。 */
  value?: unknown;
  timeout?: number;
}

export interface AutomationScript {
  id: string;
  name: string;
  description?: string;
  variables?: ScriptVariable[];
  steps: AutomationStep[];
}

export type RunStatus = "queued" | "running" | "done" | "error";

export interface RunRecord {
  runId: string;
  scriptId: string;
  variables: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  step?: number;
  total?: number;
  output?: Record<string, unknown>;
  /** 运行产物落盘路径(session capture);完成时写,跨会话可读。 */
  outputFile?: string;
  errorCode?: string;
  message?: string;
}
