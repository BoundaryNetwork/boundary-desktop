// 把一组 ThinkingMessage 合并成单个 { text, streaming }。
// 移植自 agent-ui src/lib/thinking.ts(仅改 import 路径)。
// 算法:按序拼接非空 content(\n\n 连接);任一 pending 则 streaming=true;全空返回 null。

import type { ThinkingMessage } from "../types";

export function mergeThinking(
  messages: ThinkingMessage[],
): { text: string; streaming: boolean } | null {
  if (messages.length === 0) return null;

  const parts: string[] = [];
  let streaming = false;

  for (const msg of messages) {
    const trimmed = msg.content.trim();
    if (trimmed) parts.push(trimmed);
    if (msg.pending === true) streaming = true;
  }

  if (parts.length === 0) return null;

  return {
    text: parts.join("\n\n"),
    streaming,
  };
}
