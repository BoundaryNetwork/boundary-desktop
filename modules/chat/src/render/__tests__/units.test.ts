import { describe, it, expect } from "vitest";
import { buildRenderUnits, type AssistantTurnUnit } from "../units";
import type { Message } from "../../types";

let n = 0;
function id(): string {
  return `m${n++}`;
}
function user(content: string): Message {
  return { messageId: id(), conversationId: "c", role: "user", content };
}
function assistant(content: string, pending = false): Message {
  return { messageId: id(), conversationId: "c", role: "assistant", content, pending };
}
function thinking(content: string, pending = false): Message {
  return { messageId: id(), conversationId: "c", role: "thinking", content, pending };
}
function tool(callId: string): Message {
  return {
    messageId: id(),
    conversationId: "c",
    role: "tool",
    content: "",
    toolCallId: callId,
    toolName: "search",
  };
}

describe("buildRenderUnits", () => {
  it("空输入 → 空数组", () => {
    expect(buildRenderUnits([])).toEqual([]);
  });

  it("user + assistant → 两个 unit", () => {
    const units = buildRenderUnits([user("hi"), assistant("hello")]);
    expect(units.map((u) => u.kind)).toEqual(["user", "assistant-turn"]);
    expect((units[1] as AssistantTurnUnit).text).toBe("hello");
  });

  it("第二个 user flush 前一个 turn", () => {
    const units = buildRenderUnits([user("a"), assistant("1"), user("b"), assistant("2")]);
    expect(units.map((u) => u.kind)).toEqual(["user", "assistant-turn", "user", "assistant-turn"]);
  });

  it("pending assistant → streaming=true", () => {
    const units = buildRenderUnits([user("a"), assistant("partial", true)]);
    expect((units[1] as AssistantTurnUnit).streaming).toBe(true);
  });

  it("thinking + tool 归入同一 assistant-turn", () => {
    const units = buildRenderUnits([user("a"), thinking("想一下"), tool("tc1"), assistant("答")]);
    expect(units).toHaveLength(2);
    const turn = units[1] as AssistantTurnUnit;
    expect(turn.thinking?.text).toBe("想一下");
    expect(turn.tools).toHaveLength(1);
    expect(turn.text).toBe("答");
  });

  it("edge-case 10:thinking 内容空但 pending → 合成 streaming 指示", () => {
    const units = buildRenderUnits([user("a"), thinking("", true)]);
    const turn = units[1] as AssistantTurnUnit;
    expect(turn.thinking).toEqual({ text: "", streaming: true });
  });
});
