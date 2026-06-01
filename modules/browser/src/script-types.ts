// 自动化 DSL 类型(港 openclaw AutomationScript)。
// sessionCapture / scrollForSession / transform / downloadFile + 输出 saver(jsonpath/csv)留下一阶段;
// extractZip(需 zip 库)/ saveMarkdown(需 node-html-markdown)未移植。

export interface ScriptVariable {
  key: string;
  label: string;
  type: "text" | "textarea" | "files" | "number" | "select";
  placeholder?: string;
  accept?: string;
  options?: { value: string; label: string }[];
  default?: unknown;
}

/** contextSetup 项:number 归一、derived 由 source 与 value 比较得布尔(供 step.when 用)。 */
export interface ContextSetupEntry {
  type: "number" | "derived";
  default?: number;
  source?: string;
  op?: ">" | ">=" | "<" | "<=" | "==" | "!==";
  value?: number | string;
}

// 单一事实源:script-loader 校验白名单与 ActionType 类型都从这里派生。
export const ACTION_TYPES = [
  "navigate",
  "wait",
  "click",
  "type",
  "hover",
  "scroll",
  "upload",
  "waitForElement",
  "waitForSelector",
  "waitForNavigation",
  "waitForLoad",
  "reload",
  "execute",
  "assertPageState",
  "extract",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface AutomationStep {
  id?: string;
  action: ActionType;
  description?: string;
  target?: { selector?: string; text?: string };
  /** navigate:url;type:文本;extract:{key,attr?};scroll:无 target 时 deltaY。字符串字段支持 {{var}} 插值。 */
  value?: unknown;
  /** wait / 随机停顿区间 [min,max] 毫秒。 */
  duration?: [number, number];
  timeout?: number;
  /** continue:本步(含重试)失败也不中断脚本。 */
  timeoutMode?: "fail" | "continue";
  retry?: number;
  retryDelay?: number;
  retryDelayMin?: number;
  retryDelayMax?: number;
  /** 本步完成后的停顿:数值或 [min,max] 随机。 */
  postWait?: number | [number, number];
  /** type:已聚焦则跳过定位+点击直接输入。 */
  noClick?: boolean;
  /** upload:隐藏 file input 选择器(走 DataTransfer 注入,不点击)。 */
  inputSelector?: string;
  /** upload:可见触发器(点击打开系统文件框)。 */
  trigger?: { selector?: string; text?: string };
  /** 仅当 ctx[when] 为真才执行本步。 */
  when?: string;
  params?: Record<string, unknown>;
}

export interface AutomationScript {
  id: string;
  name: string;
  description?: string;
  platform?: string;
  startUrl?: string;
  variables?: ScriptVariable[];
  contextSetup?: Record<string, ContextSetupEntry>;
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
