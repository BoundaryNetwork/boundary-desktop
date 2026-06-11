import { describe, it, expect } from "vitest";
import { mergeToolMessages, isToolOutputError } from "../tool";
import type { ToolMessage, ToolResultMessage } from "../../types";

function call(id: string, callId: string, name = "search", args: unknown = { q: "x" }): ToolMessage {
  return {
    messageId: id,
    conversationId: "c",
    role: "tool",
    content: "",
    toolCallId: callId,
    toolName: name,
    toolArguments: args,
  };
}
function result(id: string, callId: string, content: string): ToolResultMessage {
  return {
    messageId: id,
    conversationId: "c",
    role: "tool_result",
    content,
    toolCallId: callId,
    toolName: "search",
  };
}

describe("mergeToolMessages", () => {
  it("按 toolCallId 配对 call + result", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m2", "tc1", "ok")]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "tc1", name: "search", outputText: "ok", isError: false });
    expect(cards[0].inputText).toContain('"q"');
  });

  it("未配对 call → outputText undefined", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], []);
    expect(cards[0].outputText).toBeUndefined();
  });

  it("未配对 result 追加在末尾", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m9", "tcX", "orphan")]);
    expect(cards).toHaveLength(2);
    expect(cards[1].outputText).toBe("orphan");
    expect(cards[1].inputText).toBe("");
  });

  it("result 含 status:error → isError=true", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m2", "tc1", '{"status":"error"}')]);
    expect(cards[0].isError).toBe(true);
  });
});

describe("isToolOutputError", () => {
  it("纯文本非错误", () => {
    expect(isToolOutputError("hello")).toBe(false);
  });
  it("JSON 带 error 键判错误", () => {
    expect(isToolOutputError('{"error":"boom"}')).toBe(true);
  });
});
