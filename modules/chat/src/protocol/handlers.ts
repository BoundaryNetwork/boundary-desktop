// WS 入帧 → stream store reducers 的映射 + rAF 合批。
// 移植自 agent-ui ws-bridge-handlers.ts + delta-coalescer.ts(剥辅助子系统;coalescer 换 rAF)。

import type { NotifyOptions } from "@boundary-desktop/contract";
import { useConvStreamStore } from "../state/stream";
import type { ServerMessage, ErrorResponse } from "../types";

type Notify = (opts: NotifyOptions) => void;

// ErrorResponse.kind 是非字面量 string,会污染 kind 判别联合的窄化(每个 case 都会带上
// ErrorResponse)。故先用类型守卫把错误帧分流出去:false 分支收窄成 Exclude<_, ErrorResponse>,
// 余下成员皆为字面量 kind,switch 才能干净窄化。识别错误帧 = ok:false 且 kind 不在已知响应集合内。
const RESPONSE_KINDS = new Set<string>([
  "turn_started",
  "output_delta",
  "reasoning_delta",
  "tool_call",
  "tool_result",
  "turn_completed",
  "turn_snapshot",
  "conversation_appended",
  "stop_turn_result",
  "subscription_result",
  "turn_result",
  "conversation_history_page_result",
  "pong",
]);

function isErrorFrame(frame: ServerMessage): frame is ErrorResponse {
  return frame.ok === false && !RESPONSE_KINDS.has(frame.kind);
}

// ─── rAF 合批:高频 output_delta / reasoning_delta 攒到下一帧再写 store,避免逐帧 O(N²) 重渲 ──

interface DeltaBuf {
  output: string;
  reasoning: string;
}
const buffers = new Map<string, DeltaBuf>();
let rafHandle: number | null = null;

function getBuf(id: string): DeltaBuf {
  let b = buffers.get(id);
  if (!b) {
    b = { output: "", reasoning: "" };
    buffers.set(id, b);
  }
  return b;
}

function schedule(): void {
  if (rafHandle != null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    flushAll();
  });
}

function enqueueOutput(id: string, text: string): void {
  getBuf(id).output += text;
  schedule();
}

function enqueueReasoning(id: string, text: string): void {
  getBuf(id).reasoning += text;
  schedule();
}

/** 把某会话攒的 delta 落 store:reasoning 先于 output(保证 thinking 排在 assistant 前)。 */
function flushConv(id: string): void {
  const b = buffers.get(id);
  if (!b) return;
  buffers.delete(id);
  const store = useConvStreamStore.getState();
  if (b.reasoning) store.applyReasoningDelta(id, b.reasoning);
  if (b.output) store.applyOutputDelta(id, b.output);
}

function flushAll(): void {
  for (const id of [...buffers.keys()]) flushConv(id);
}

/** 丢弃某会话攒的 delta(error / snapshot 重放前,积压必须作废)。 */
function discardConv(id: string): void {
  buffers.delete(id);
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

export function createFrameDispatcher(notify: Notify): (frame: ServerMessage) => void {
  return function dispatch(frame: ServerMessage): void {
    const store = useConvStreamStore.getState();
    // 错误帧(kind 非字面量)先分流:带 conversation_id 则写 error 终态。
    if (isErrorFrame(frame)) {
      const msg = frame.error ?? "未知错误";
      notify({ level: "error", message: msg });
      if (frame.conversation_id) {
        discardConv(frame.conversation_id);
        store.applyErrorFrame(frame.conversation_id, msg);
      }
      return;
    }
    switch (frame.kind) {
      case "turn_started":
        flushConv(frame.conversation_id);
        store.applyTurnStarted(frame.conversation_id);
        break;
      case "output_delta":
        enqueueOutput(frame.conversation_id, frame.output_text);
        break;
      case "reasoning_delta":
        enqueueReasoning(frame.conversation_id, frame.reasoning_text);
        break;
      case "tool_call":
        flushConv(frame.conversation_id); // 工具调用前先落文本,保证顺序
        store.applyToolCall(frame.conversation_id, frame.tool_call);
        break;
      case "tool_result":
        flushConv(frame.conversation_id);
        store.applyToolResult(frame.conversation_id, frame.tool_result);
        break;
      case "turn_completed":
        flushConv(frame.conversation_id);
        store.applyTurnCompleted(frame.conversation_id, frame);
        if (!frame.ok && frame.error) {
          notify({ level: "error", message: frame.error });
        } else if (frame.finish_reason === "cancelled") {
          notify({ level: "info", message: "已停止" });
        }
        break;
      case "turn_snapshot":
        discardConv(frame.conversation_id);
        store.applySnapshot(frame.conversation_id, frame);
        break;
      case "conversation_appended":
        flushConv(frame.conversation_id);
        store.applyConversationAppended(frame.conversation_id, frame.messages);
        break;
      case "stop_turn_result":
        if (!frame.stopped) notify({ level: "warning", message: "未找到正在进行的对话" });
        break;
      case "subscription_result":
      case "turn_result": // 非流式结果;流式路径由 turn_completed 收口
      case "conversation_history_page_result": // MVP 走 REST 拉历史
      case "pong":
        break;
      default:
        break; // 错误帧已在 switch 前分流;其余未知响应 ignore
    }
  };
}
