// agentworkerd REST/WS 协议响应类型的手抄子集(模块级与契约同步,见 docs/agent-kernel-eval.md)。
// 字段名严格对齐 worker 线格式(snake_case);裁掉 MVP 外的帧/DTO。

// ─── Message(UI/store 内部模型)────────────────────────────────────────────
export type MessageRole = "user" | "assistant" | "thinking" | "tool" | "tool_result";

export interface ConversationReferenceView {
  direction: "input" | "output";
  source: "attachment" | "workspace_file";
  name: string;
  media_type: string;
  attachment_id?: string;
  path?: string;
  operation?: string;
  download_url?: string;
  preview_url?: string;
  text_url?: string;
}

export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ApprovalReason {
  kind:
    | "protected_path_access"
    | "dangerous_token"
    | "existing_file_overwrite"
    | "file_content_removal"
    | "destructive_program";
  path?: string;
  token?: string;
  program?: string;
}

export interface ApprovalRequiredTurn {
  id: string;
  tool_name: string;
  approval_key: string;
  risk_level: "low" | "medium" | "high" | "critical";
  reasons: ApprovalReason[];
}

export interface BaseMessage {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  pending?: boolean;
  references?: ConversationReferenceView[];
}
export interface UserMessage extends BaseMessage {
  role: "user";
}
export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  cancelled?: boolean;
  usage?: TurnUsage;
  approval?: ApprovalRequiredTurn;
}
export interface ThinkingMessage extends BaseMessage {
  role: "thinking";
}
export interface ToolMessage extends BaseMessage {
  role: "tool";
  toolCallId?: string;
  toolName?: string;
  toolArguments?: unknown;
  cancelled?: boolean;
  usage?: TurnUsage;
}
export interface ToolResultMessage extends BaseMessage {
  role: "tool_result";
  toolCallId?: string;
  toolName?: string;
}
export type Message =
  | UserMessage
  | AssistantMessage
  | ThinkingMessage
  | ToolMessage
  | ToolResultMessage;

// ─── REST DTO ────────────────────────────────────────────────────────────────
export interface ConversationSummary {
  conversation_id: string;
  name?: string;
  last_turn_at: string | null;
}

export interface ConversationHistoryMessage {
  cursor: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  references?: ConversationReferenceView[];
  usage?: TurnUsage;
  tool_call_id?: string;
  tool_name?: string;
  tool_arguments?: unknown;
  cancelled?: boolean;
}

export interface ConversationHistoryResponse {
  conversation_id: string;
  // worker 对空会话省略 messages 字段(serde 跳过空 Vec);消费侧需 ?? [] 兜底。
  messages?: ConversationHistoryMessage[];
  has_more: boolean;
  next_before?: string;
}

// worker 是多 agent-instance 的,会话端点靠 agent_instance_id 路由。无默认实例时该字段必填。
export interface InstanceSummary {
  agent_instance_id: string;
  name?: string;
}
export interface ListInstancesResponse {
  instances?: InstanceSummary[];
  default_instance_id?: string;
}

// ─── WS 出帧(client → server,判别字段 type)─────────────────────────────────
export interface WsTurnRequest {
  type: "turn";
  message: string;
  conversation_id?: string;
  agent_instance_id?: string;
  stream?: boolean;
}
export interface WsStopTurnRequest {
  type: "stop_turn";
  conversation_id: string;
  agent_instance_id?: string;
}
export interface WsSubscribeConversationRequest {
  type: "subscribe_conversation";
  conversation_id: string;
  agent_instance_id?: string;
}
export interface WsUnsubscribeConversationRequest {
  type: "unsubscribe_conversation";
  conversation_id: string;
  agent_instance_id?: string;
}
export interface WsPingRequest {
  type: "ping"; // 心跳;worker 回 { kind: "pong" }
}
export type WsClientRequest =
  | WsTurnRequest
  | WsStopTurnRequest
  | WsSubscribeConversationRequest
  | WsUnsubscribeConversationRequest
  | WsPingRequest;

// ─── WS 入帧:流事件(stream=true turn 内,判别字段 kind,都有 ok)──────────────
export interface TurnStartedEvent {
  ok: boolean;
  kind: "turn_started";
  conversation_id: string;
}
export interface OutputDeltaEvent {
  ok: boolean;
  kind: "output_delta";
  conversation_id: string;
  output_text: string;
}
export interface ReasoningDeltaEvent {
  ok: boolean;
  kind: "reasoning_delta";
  conversation_id: string;
  reasoning_text: string;
}
export interface ToolCallEvent {
  ok: boolean;
  kind: "tool_call";
  conversation_id: string;
  tool_call: { id: string; name: string; arguments: unknown };
}
export interface ToolResultEvent {
  ok: boolean;
  kind: "tool_result";
  conversation_id: string;
  tool_result: { tool_call_id: string; tool_name: string; content: string };
}
export interface TurnCompletedEvent {
  ok: boolean;
  kind: "turn_completed";
  conversation_id: string;
  output_text?: string;
  finish_reason?: string;
  error?: string;
  approval?: ApprovalRequiredTurn;
  usage?: TurnUsage;
  turn_at?: string;
  turn_index?: number;
  cursor?: string;
}
export type WsStreamEvent =
  | TurnStartedEvent
  | OutputDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnCompletedEvent;

// ─── WS 入帧:响应(判别字段 kind)──────────────────────────────────────────────
export interface TurnSnapshotResponse {
  ok: true;
  kind: "turn_snapshot";
  conversation_id: string;
  turn_id: number;
  base_message_count: number;
  state: "streaming" | "tool_running" | "awaiting_approval";
  events?: WsStreamEvent[]; // worker 空数组时省略字段 → undefined,reducer 用 ?? []
}
export interface ConversationAppendedResponse {
  ok: boolean;
  kind: "conversation_appended";
  conversation_id: string;
  messages: ConversationHistoryMessage[];
}
export interface StopTurnResultResponse {
  ok: boolean;
  kind: "stop_turn_result";
  conversation_id: string;
  stopped: boolean;
}
export interface SubscriptionResultResponse {
  ok: boolean;
  kind: "subscription_result";
  conversation_id: string;
  status: "subscribed" | "unsubscribed";
}
export interface TurnResultResponse {
  ok: boolean;
  kind: "turn_result";
  conversation_id: string;
  output_text?: string;
  finish_reason?: string;
  usage?: TurnUsage;
  approval?: ApprovalRequiredTurn;
}
export interface ConversationHistoryPageResultResponse {
  ok: boolean;
  kind: "conversation_history_page_result";
  conversation_id: string;
  messages: ConversationHistoryMessage[];
  has_more: boolean;
  next_before?: string;
}
export interface PongResponse {
  ok: boolean;
  kind: "pong";
}
export interface ErrorResponse {
  ok: false;
  kind: string; // error 帧 kind 非字面量;落 dispatch default 分支
  conversation_id?: string;
  error: string; // 字段名是 error,不是 message
}

export type ServerMessage =
  | WsStreamEvent
  | TurnSnapshotResponse
  | ConversationAppendedResponse
  | StopTurnResultResponse
  | SubscriptionResultResponse
  | TurnResultResponse
  | ConversationHistoryPageResultResponse
  | PongResponse
  | ErrorResponse;
