// Message[] → RenderUnit[] 的 turn 分组状态机。
// 移植自 agent-ui src/lib/render-units.ts(仅改 import 路径)。
// 算法:遇 user flush 当前 turn 并起新 turn;thinking/tool/tool_result/assistant 累积;末尾 flush。
// edge-case 10:mergeThinking 全空返回 null,但若有 pending thinking 则合成 { text:'', streaming:true }
//   让流式 UI 在内容到达前先显示"正在思考"。

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  ToolResultMessage,
} from "../types";
import { mergeToolMessages, type ToolCard } from "./tool";
import { mergeThinking } from "./thinking";

export interface UserUnit {
  kind: "user";
  key: string;
  message: UserMessage;
}

export interface AssistantTurnUnit {
  kind: "assistant-turn";
  key: string;
  thinking: { text: string; streaming: boolean } | null;
  tools: ToolCard[];
  text: string;
  finalAssistant: AssistantMessage | null;
  streaming: boolean;
  cancelled: boolean;
  errorMessage?: string;
}

export interface SystemUnit {
  kind: "system";
  key: string;
  text: string;
}

export type RenderUnit = UserUnit | AssistantTurnUnit | SystemUnit;

interface TurnAccumulator {
  thinkingMsgs: ThinkingMessage[];
  toolMsgs: ToolMessage[];
  toolResultMsgs: ToolResultMessage[];
  finalAssistant: AssistantMessage | null;
  firstId: string | null;
}

function emptyAccumulator(): TurnAccumulator {
  return {
    thinkingMsgs: [],
    toolMsgs: [],
    toolResultMsgs: [],
    finalAssistant: null,
    firstId: null,
  };
}

function recordFirstId(acc: TurnAccumulator, id: string): void {
  if (acc.firstId === null) acc.firstId = id;
}

function flushTurn(acc: TurnAccumulator): AssistantTurnUnit | null {
  const { thinkingMsgs, toolMsgs, toolResultMsgs, finalAssistant, firstId } = acc;

  if (
    thinkingMsgs.length === 0 &&
    toolMsgs.length === 0 &&
    toolResultMsgs.length === 0 &&
    finalAssistant === null
  ) {
    return null;
  }

  const key =
    firstId ??
    finalAssistant?.messageId ??
    toolMsgs[0]?.messageId ??
    toolResultMsgs[0]?.messageId ??
    "__unknown__";

  let thinking = mergeThinking(thinkingMsgs);
  if (thinking === null && thinkingMsgs.some((m) => m.pending === true)) {
    thinking = { text: "", streaming: true };
  }

  const tools: ToolCard[] = mergeToolMessages(toolMsgs, toolResultMsgs);

  const text = finalAssistant?.content ?? "";

  const streaming =
    finalAssistant?.pending === true ||
    thinkingMsgs.some((m) => m.pending === true) ||
    toolMsgs.some((m) => m.pending === true);

  const cancelled =
    finalAssistant?.cancelled === true ||
    (finalAssistant === null && toolMsgs[0]?.cancelled === true);

  return {
    kind: "assistant-turn",
    key,
    thinking,
    tools,
    text,
    finalAssistant,
    streaming,
    cancelled,
  };
}

export function buildRenderUnits(messages: Message[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let acc = emptyAccumulator();

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const turn = flushTurn(acc);
        if (turn) units.push(turn);
        acc = emptyAccumulator();

        units.push({
          kind: "user",
          key: msg.messageId,
          message: msg,
        });
        break;
      }

      case "thinking": {
        recordFirstId(acc, msg.messageId);
        acc.thinkingMsgs.push(msg);
        break;
      }

      case "tool": {
        recordFirstId(acc, msg.messageId);
        acc.toolMsgs.push(msg);
        break;
      }

      case "tool_result": {
        recordFirstId(acc, msg.messageId);
        acc.toolResultMsgs.push(msg);
        break;
      }

      case "assistant": {
        recordFirstId(acc, msg.messageId);
        acc.finalAssistant = msg;
        break;
      }
    }
  }

  const lastTurn = flushTurn(acc);
  if (lastTurn) units.push(lastTurn);

  return units;
}
