// ToolMessage + ToolResultMessage 按 toolCallId 配对成 ToolCard[]。
// 移植自 agent-ui src/lib/tool-cards.ts(仅改 import 路径)。

import type { ToolMessage, ToolResultMessage } from "../types";

export interface ToolCard {
  id: string; // = toolCallId(或 ToolMessage.messageId 兜底)
  name: string; // = toolName
  inputText: string; // = stringify(toolArguments) 或 ToolMessage.content
  outputText: string | undefined; // = 配对 ToolResultMessage.content;未配对为 undefined
  isError: boolean;
}

export const PREVIEW_MAX_LINES = 2;
export const PREVIEW_MAX_CHARS = 100;
export const TOOL_INLINE_THRESHOLD = 240;

function serializeInput(msg: ToolMessage): string {
  if (msg.toolArguments !== undefined && msg.toolArguments !== null) {
    if (typeof msg.toolArguments === "string") return msg.toolArguments;
    try {
      return JSON.stringify(msg.toolArguments, null, 2);
    } catch {
      return Object.prototype.toString.call(msg.toolArguments);
    }
  }
  return msg.content;
}

export function isToolOutputError(text: string | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const status = (parsed as { status?: unknown }).status;
    if (typeof status === "string" && status.toLowerCase() === "error") return true;
    return "error" in (parsed as object);
  } catch {
    return false;
  }
}

function isResultError(result: ToolResultMessage): boolean {
  return isToolOutputError(result.content);
}

export function mergeToolMessages(
  calls: ToolMessage[],
  results: ToolResultMessage[],
): ToolCard[] {
  const resultsByCallId = new Map<string, ToolResultMessage[]>();
  const usedResultIds = new Set<string>();

  for (const result of results) {
    const callId = result.toolCallId;
    if (callId) {
      const existing = resultsByCallId.get(callId);
      if (existing) {
        existing.push(result);
      } else {
        resultsByCallId.set(callId, [result]);
      }
    }
  }

  const cards: ToolCard[] = [];

  for (const call of calls) {
    const callId = call.toolCallId;
    let paired: ToolResultMessage | undefined;

    if (callId) {
      const bucket = resultsByCallId.get(callId);
      if (bucket && bucket.length > 0) {
        paired = bucket.find((r) => !usedResultIds.has(r.messageId));
        if (paired) usedResultIds.add(paired.messageId);
      }
    }

    cards.push({
      id: callId ?? call.messageId,
      name: call.toolName ?? "tool",
      inputText: serializeInput(call),
      outputText: paired?.content,
      isError: paired ? isResultError(paired) : false,
    });
  }

  for (const result of results) {
    if (usedResultIds.has(result.messageId)) continue;
    const callId = result.toolCallId;
    if (callId && usedResultIds.has(result.messageId)) continue;

    cards.push({
      id: callId ?? result.messageId,
      name: result.toolName ?? "tool",
      inputText: "",
      outputText: result.content,
      isError: isResultError(result),
    });
  }

  return cards;
}

export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return preview.slice(0, PREVIEW_MAX_CHARS) + "…";
  }
  return lines.length < allLines.length ? preview + "…" : preview;
}
