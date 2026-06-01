// 自动化 DSL 类型(港 openclaw AutomationScript)。
// downloadFile / extractZip(需 zip 库)/ saveMarkdown(需 node-html-markdown)未移植。

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

/** 从一条接口响应抽某字段:path 用 . 分层 + [] 标记数组锚点;reg 为 "search::replace";type=array 取全部。 */
export interface ValueKeySpec {
  name: string;
  path: string;
  reg?: string;
  type?: "array";
}

/** sessionCapture 的采集规格:命中 urlIncludes 的响应按 valueKey 抽行累积到 sessionKey。 */
export interface SessionSpec {
  sessionKey: string;
  when?: string;
  urlIncludes: string[];
  valueKey: ValueKeySpec[];
  hasNextKey?: string;
}

/** csv 输出列规格。source 取 session 或 context 的某键;rowsFrom 在该值为对象时指定内部数组属性。 */
export interface OutputCsvSpec {
  type: string;
  source: string;
  rowsFrom?: string;
  columns: { name: string; from: string; joinWith?: string }[];
}

export interface OutputSchema {
  json?: boolean;
  csv?: OutputCsvSpec[];
  excludeSessionKeys?: string[];
  filename?: { prefix?: string; itemIdFrom?: string };
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
  "sessionCapture",
  "scrollForSession",
  "transform",
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
  outputSchema?: OutputSchema;
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
  /** 运行结果:{ context(extract/execute 产物), sessions(各 sessionKey 抽到的行) }。 */
  output?: { context: Record<string, unknown>; sessions: Record<string, Record<string, unknown>[]> };
  /** 各 sessionKey 采集条数概要(避免把全量塞进调用方上下文)。 */
  sessions?: Record<string, number>;
  /** 写出的 csv 文件路径。 */
  outputFiles?: string[];
  /** run 记录落盘路径(<runId>.json);完成时写,跨会话可读。 */
  outputFile?: string;
  errorCode?: string;
  message?: string;
}
