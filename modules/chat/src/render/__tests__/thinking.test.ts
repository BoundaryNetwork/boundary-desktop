import { describe, it, expect } from "vitest";
import { mergeThinking } from "../thinking";
import type { ThinkingMessage } from "../../types";

function think(content: string, pending = false): ThinkingMessage {
  return { messageId: "t", conversationId: "c", role: "thinking", content, pending };
}

describe("mergeThinking", () => {
  it("空数组返回 null", () => {
    expect(mergeThinking([])).toBeNull();
  });

  it("全空白 content 返回 null", () => {
    expect(mergeThinking([think("  "), think("\n")])).toBeNull();
  });

  it("拼接非空 content,\\n\\n 连接", () => {
    expect(mergeThinking([think("a"), think(""), think("b")])).toEqual({
      text: "a\n\nb",
      streaming: false,
    });
  });

  it("任一 pending → streaming=true", () => {
    expect(mergeThinking([think("a"), think("b", true)])?.streaming).toBe(true);
  });
});
