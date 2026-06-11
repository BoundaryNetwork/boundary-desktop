// 单 store 流式状态机:apply* reducers。
// 移植自 agent-ui src/stores/conversation-stream.store.ts(裁剪 agentInstanceId / store-reset,
// uuid 改 crypto.randomUUID,import 改相对;reducer 与内部 mutator 语义不变)。
// 依赖 zustand immer middleware:mutable 写法产出 immutable 结果。

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  ConversationHistoryMessage,
  TurnCompletedEvent,
  TurnSnapshotResponse,
  WsStreamEvent,
  Message,
  MessageRole,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  ToolResultMessage,
} from "../types";
import { useConversationStore } from "./conversation";

// ─── Store state shape ────────────────────────────────────────────────────────

/** Public per-conv view(UI 渲染读这个）*/
export interface ConvStreamState {
  messages: Message[];
  sending: boolean;
  /** snapshot.state 映射;'streaming' | 'tool_running' | null */
  inFlightState: string | null;
  /** 错误 banner 文本(per-conv;MVP 错误走 ctx.notify,本字段仅内部记录)*/
  error: string | null;
}

/** Internal per-conv(额外 streaming scratch 字段,单元测试可见)*/
export interface ConvStreamInternal extends ConvStreamState {
  /** output_delta 累积;turn_completed 时清空 */
  streamBuffer: string;
  /** turn_started 时 arm,conversation_appended / turn_completed 时清——见 D-5 */
  skipNextAppend: boolean;
}

function initialConvStreamInternal(): ConvStreamInternal {
  return {
    messages: [],
    sending: false,
    inFlightState: null,
    error: null,
    streamBuffer: "",
    skipNextAppend: false,
  };
}

export interface ConvStreamStoreState {
  byConversation: Record<string, ConvStreamInternal>;

  // —— Hydration / 编排 actions ——
  seedHistory(convId: string, messages: Message[]): void;
  prependHistory(convId: string, older: Message[]): void;
  appendLocal(convId: string, message: Message): void;
  clearByConversation(convId: string): void;

  // —— Wire frame reducer actions(ws 帧 dispatch 调）——
  applyTurnStarted(convId: string): void;
  applyOutputDelta(convId: string, text: string): void;
  applyReasoningDelta(convId: string, text: string): void;
  applyToolCall(convId: string, payload: { id: string; name: string; arguments: unknown }): void;
  applyToolResult(
    convId: string,
    payload: { tool_call_id: string; tool_name: string; content: string },
  ): void;
  applyTurnCompleted(convId: string, msg: TurnCompletedEvent): void;
  applyConversationAppended(convId: string, wireMessages: ConversationHistoryMessage[]): void;
  applySnapshot(convId: string, snapshot: TurnSnapshotResponse): void;
  /** turn_completed{ok:false} 走 applyTurnCompleted;不带 turn 上下文的 error 帧走这条 */
  applyErrorFrame(convId: string, error: string): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useConvStreamStore = create<ConvStreamStoreState>()(
  immer((set) => ({
    byConversation: {},

    seedHistory: (convId, messages) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages = messages;
        conv.sending = false;
        conv.inFlightState = null;
        conv.streamBuffer = "";
        conv.skipNextAppend = false;
        conv.error = null;
      }),

    prependHistory: (convId, older) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages = [...older, ...conv.messages];
      }),

    appendLocal: (convId, message) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages.push(message);
      }),

    clearByConversation: (convId) =>
      set((s) => {
        delete s.byConversation[convId];
      }),

    applyTurnStarted: (convId) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.sending = true;
        conv.inFlightState = conv.inFlightState ?? "streaming";
        conv.error = null;
        conv.skipNextAppend = true;
      }),

    applyOutputDelta: (convId, text) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyOutputDeltaMut(conv, text, convId);
      }),

    applyReasoningDelta: (convId, text) =>
      set((s) => {
        if (!text) return;
        const conv = ensureConv(s.byConversation, convId);
        appendReasoningDeltaMut(conv.messages, text, convId);
      }),

    applyToolCall: (convId, call) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyToolCallMut(conv, call, convId);
      }),

    applyToolResult: (convId, payload) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyToolResultMut(conv, payload, convId);
      }),

    /**
     * 找最后一条 assistant message → pending=false + 写 finalText/usage/cancelled/approval;
     * 没找到且有内容 → 新建一条 assistant;清 streamBuffer/sending/inFlightState;
     * 无条件清 skipNextAppend(D-5);!ok && error && !approval 时写错误 banner。
     */
    applyTurnCompleted: (convId, completed) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        const finalText = completed.output_text ?? conv.streamBuffer ?? "";
        const finalTimestamp = new Date().toISOString();
        const cancelled = completed.finish_reason === "cancelled";

        sealThinkingMut(conv.messages);

        let lastAiIdx = -1;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
          const r = conv.messages[i].role;
          if (r === "user") break;
          if (r === "assistant") {
            lastAiIdx = i;
            break;
          }
        }

        if (lastAiIdx >= 0) {
          const target = conv.messages[lastAiIdx] as AssistantMessage;
          target.content = target.pending
            ? finalText
            : target.content && target.content.length > 0
              ? target.content
              : finalText;
          target.timestamp = target.timestamp ?? finalTimestamp;
          target.pending = false;
          target.cancelled = cancelled || target.cancelled;
          if (completed.usage) target.usage = completed.usage;
          if (completed.approval) target.approval = completed.approval;
        } else if (finalText.length > 0 || completed.usage || completed.approval) {
          conv.messages.push({
            messageId: generatePendingId(),
            conversationId: convId,
            role: "assistant",
            content: finalText,
            timestamp: finalTimestamp,
            pending: false,
            cancelled,
            usage: completed.usage,
            approval: completed.approval,
          });
        }

        conv.streamBuffer = "";
        conv.sending = false;
        conv.inFlightState = null;
        conv.skipNextAppend = false;
        if (!completed.ok && completed.error && !completed.approval) {
          conv.error = completed.error;
        }
      }),

    /**
     * skipNextAppend=true 时整批 drop(turn_started arm 的 echo dedupe);
     * 否则 dropTrailingPending + 追加 historyMessageToLocal 转换后的消息。
     * 兼任 turn 结束副作用:清 streamBuffer + sending=false + inFlightState=null。
     */
    applyConversationAppended: (convId, wireMessages) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        if (conv.skipNextAppend) {
          conv.skipNextAppend = false;
          return;
        }
        dropTrailingPendingMut(conv.messages);
        for (const m of wireMessages) {
          conv.messages.push(historyMessageToLocal(m, convId));
        }
        conv.streamBuffer = "";
        conv.sending = false;
        conv.inFlightState = null;
      }),

    /**
     * subscribe in-flight turn 时服务端 push 的 turn-so-far 快照。
     * 重 reduce:dropTrailingPending + 重放 events;streamBuffer 进 reduce 前清空(R-1)。
     * arm skipNextAppend=true(re-subscribe 路径也要 dedupe echo)。events 可能 undefined,用 ?? []。
     */
    applySnapshot: (convId, snapshot) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.streamBuffer = "";
        dropTrailingPendingMut(conv.messages);
        conv.sending = true;
        conv.inFlightState = snapshot.state ?? "streaming";

        const events = snapshot.events ?? [];
        for (const event of events) {
          reduceEventInPlace(conv, event, convId);
        }

        conv.sending = true;
        conv.inFlightState = snapshot.state ?? "streaming";
        conv.skipNextAppend = true;
      }),

    applyErrorFrame: (convId, error) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.sending = false;
        conv.inFlightState = null;
        conv.error = error;
        dropTrailingPendingMut(conv.messages);
      }),
  })),
);

// ─── Internal helpers(不导出)────────────────────────────────────────────────

function ensureConv(
  byConversation: Record<string, ConvStreamInternal>,
  convId: string,
): ConvStreamInternal {
  if (!byConversation[convId]) {
    byConversation[convId] = initialConvStreamInternal();
  }
  return byConversation[convId];
}

/** `pending-${crypto.randomUUID()}` */
export function generatePendingId(): string {
  return `pending-${crypto.randomUUID()}`;
}

/** 把数组里所有 pending thinking message 封口(必须遍历全数组,thinking 可能不在末尾)。 */
function sealThinkingMut(messages: Message[]): void {
  for (const m of messages) {
    if (m.role === "thinking" && m.pending) {
      m.pending = false;
    }
  }
}

/** 把末尾 pending assistant message 封口。 */
function finalizePendingAiMut(messages: Message[]): void {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.pending) {
    last.pending = false;
  }
}

/** 移除末尾所有 pending=true 消息。 */
export function dropTrailingPendingMut(messages: Message[]): void {
  while (messages.length > 0 && messages[messages.length - 1].pending) {
    messages.pop();
  }
}

/** tool content 可能是对象,序列化成字符串。 */
function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** 单条 history wire 消息 → store Message。 */
export function historyMessageToLocal(m: ConversationHistoryMessage, convId: string): Message {
  const { cursor, role, content, timestamp, references, usage, tool_call_id, tool_name, tool_arguments, cancelled } = m;

  const base: BaseMessage = {
    messageId: cursor,
    conversationId: convId,
    role: role as MessageRole,
    content,
    timestamp,
    references: references ?? [],
    pending: false,
  };

  switch (role) {
    case "user":
      return { ...base, role: "user" } as UserMessage;
    case "assistant":
      return { ...base, role: "assistant", cancelled, usage } as AssistantMessage;
    case "thinking":
      return { ...base, role: "thinking" } as ThinkingMessage;
    case "tool":
      return {
        ...base,
        role: "tool",
        toolCallId: tool_call_id,
        toolName: tool_name,
        toolArguments: tool_arguments,
        cancelled,
        usage,
      } as ToolMessage;
    case "tool_result":
      return { ...base, role: "tool_result", toolCallId: tool_call_id, toolName: tool_name } as ToolResultMessage;
    default:
      return { ...base, role: "assistant" } as AssistantMessage;
  }
}

/** output_delta / snapshot replay 共用:累加 streamBuffer,写或更新末尾 pending assistant。 */
function applyOutputDeltaMut(conv: ConvStreamInternal, text: string, convId: string): void {
  conv.streamBuffer += text;
  const last = conv.messages[conv.messages.length - 1];
  if (last?.role === "assistant" && last.pending) {
    last.content = conv.streamBuffer;
  } else {
    conv.messages.push({
      messageId: generatePendingId(),
      conversationId: convId,
      role: "assistant",
      content: conv.streamBuffer,
      pending: true,
      timestamp: new Date().toISOString(),
    });
  }
  conv.inFlightState = "streaming";
  conv.sending = true;
}

/** tool_call / snapshot replay 共用:finalize 末尾 ai + seal thinking + push tool + 清 streamBuffer。 */
function applyToolCallMut(
  conv: ConvStreamInternal,
  call: { id: string; name: string; arguments: unknown },
  convId: string,
): void {
  conv.streamBuffer = "";
  finalizePendingAiMut(conv.messages);
  sealThinkingMut(conv.messages);
  conv.messages.push({
    messageId: generatePendingId(),
    conversationId: convId,
    role: "tool",
    content: "",
    toolCallId: call.id,
    toolName: call.name,
    toolArguments: call.arguments,
    timestamp: new Date().toISOString(),
  });
  conv.inFlightState = "tool_running";
}

/** tool_result / snapshot replay 共用:finalize 末尾 ai + seal thinking + push tool_result。 */
function applyToolResultMut(
  conv: ConvStreamInternal,
  payload: { tool_call_id: string; tool_name: string; content: string },
  convId: string,
): void {
  finalizePendingAiMut(conv.messages);
  sealThinkingMut(conv.messages);
  conv.messages.push({
    messageId: generatePendingId(),
    conversationId: convId,
    role: "tool_result",
    content: stringifyToolContent(payload.content),
    toolCallId: payload.tool_call_id,
    toolName: payload.tool_name,
    timestamp: new Date().toISOString(),
  });
  conv.inFlightState = "streaming";
}

/** snapshot.events 重放派发器(不处理 turn_started / turn_completed;未知类型 ignore)。 */
function reduceEventInPlace(conv: ConvStreamInternal, event: WsStreamEvent, convId: string): void {
  switch (event.kind) {
    case "output_delta":
      applyOutputDeltaMut(conv, event.output_text, convId);
      break;
    case "reasoning_delta":
      if (event.reasoning_text) {
        appendReasoningDeltaMut(conv.messages, event.reasoning_text, convId);
      }
      break;
    case "tool_call":
      applyToolCallMut(conv, event.tool_call, convId);
      break;
    case "tool_result":
      applyToolResultMut(conv, event.tool_result, convId);
      break;
    default:
      break;
  }
}

/** reasoning 累积:暂存末尾 pending assistant → 累积/新建 pending thinking → 放回 assistant。 */
function appendReasoningDeltaMut(messages: Message[], delta: string, convId: string): void {
  const last = messages[messages.length - 1];
  const pendingAi = last?.role === "assistant" && last.pending ? messages.pop() : null;

  const newLast = messages[messages.length - 1];
  if (newLast?.role === "thinking" && newLast.pending) {
    newLast.content += delta;
  } else {
    messages.push({
      messageId: generatePendingId(),
      conversationId: convId,
      role: "thinking",
      content: delta,
      pending: true,
      timestamp: new Date().toISOString(),
    });
  }

  if (pendingAi) messages.push(pendingAi);
}

// ─── Selectors / hooks ───────────────────────────────────────────────────────

export function useCurrentConvStream(): ConvStreamState | undefined {
  const currentId = useConversationStore((s) => s.currentId);
  return useConvStreamStore((s) => (currentId ? s.byConversation[currentId] : undefined));
}

export function useCurrentMessages(): Message[] {
  return useCurrentConvStream()?.messages ?? [];
}

export function useCurrentSending(): boolean {
  return useCurrentConvStream()?.sending ?? false;
}

export function byConversationHasEntry(id: string): boolean {
  return !!useConvStreamStore.getState().byConversation[id];
}
