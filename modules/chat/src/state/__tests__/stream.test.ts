import { describe, it, expect, beforeEach } from "vitest";
import { useConvStreamStore } from "../stream";
import type { TurnCompletedEvent } from "../../types";

function getConv(id: string) {
  return useConvStreamStore.getState().byConversation[id];
}
const store = () => useConvStreamStore.getState();

beforeEach(() => {
  useConvStreamStore.setState({ byConversation: {} });
});

describe("stream reducers", () => {
  it("seedHistory 整体替换并重置 scratch", () => {
    store().seedHistory("c", [
      { messageId: "m1", conversationId: "c", role: "user", content: "hi" },
    ]);
    expect(getConv("c").messages).toHaveLength(1);
    expect(getConv("c").sending).toBe(false);
    expect(getConv("c").streamBuffer).toBe("");
  });

  it("applyTurnStarted arm sending + skipNextAppend", () => {
    store().applyTurnStarted("c");
    expect(getConv("c").sending).toBe(true);
    expect(getConv("c").skipNextAppend).toBe(true);
  });

  it("applyOutputDelta 累加进末尾 pending assistant", () => {
    store().applyOutputDelta("c", "Hel");
    store().applyOutputDelta("c", "lo");
    const msgs = getConv("c").messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "assistant", content: "Hello", pending: true });
  });

  it("applyReasoningDelta 累积进 pending thinking,且排在 pending assistant 前", () => {
    store().applyOutputDelta("c", "answer");
    store().applyReasoningDelta("c", "think...");
    const roles = getConv("c").messages.map((m) => m.role);
    expect(roles).toEqual(["thinking", "assistant"]);
  });

  it("applyToolCall finalize pending ai + push tool", () => {
    store().applyOutputDelta("c", "partial");
    store().applyToolCall("c", { id: "tc1", name: "search", arguments: {} });
    const msgs = getConv("c").messages;
    expect(msgs[0].pending).toBe(false); // assistant 封口
    expect(msgs[1]).toMatchObject({ role: "tool", toolCallId: "tc1" });
    expect(getConv("c").streamBuffer).toBe("");
  });

  it("applyTurnCompleted 封口末尾 assistant 并清终态", () => {
    store().applyTurnStarted("c");
    store().applyOutputDelta("c", "done");
    const completed: TurnCompletedEvent = {
      ok: true,
      kind: "turn_completed",
      conversation_id: "c",
    };
    store().applyTurnCompleted("c", completed);
    const conv = getConv("c");
    expect(conv.messages[0]).toMatchObject({ role: "assistant", content: "done", pending: false });
    expect(conv.sending).toBe(false);
    expect(conv.skipNextAppend).toBe(false);
    expect(conv.streamBuffer).toBe("");
  });

  it("applyTurnCompleted{cancelled} 标记 cancelled", () => {
    store().applyOutputDelta("c", "x");
    store().applyTurnCompleted("c", {
      ok: true,
      kind: "turn_completed",
      conversation_id: "c",
      finish_reason: "cancelled",
    });
    expect((getConv("c").messages[0] as { cancelled?: boolean }).cancelled).toBe(true);
  });

  it("applyConversationAppended skipNextAppend=true 时整批丢弃", () => {
    store().applyTurnStarted("c"); // arm skip
    store().applyConversationAppended("c", [
      { cursor: "x1", role: "user", content: "echo" },
    ]);
    expect(getConv("c").messages).toHaveLength(0);
    expect(getConv("c").skipNextAppend).toBe(false);
  });

  it("applyConversationAppended 未 arm 时追加并转换", () => {
    store().applyConversationAppended("c", [
      { cursor: "x1", role: "assistant", content: "hi" },
    ]);
    expect(getConv("c").messages[0]).toMatchObject({ messageId: "x1", role: "assistant", content: "hi" });
  });

  it("applyErrorFrame 删尾部 pending 并写 error 终态", () => {
    store().applyOutputDelta("c", "half"); // 产生 pending assistant
    store().applyErrorFrame("c", "boom");
    const conv = getConv("c");
    expect(conv.messages).toHaveLength(0);
    expect(conv.error).toBe("boom");
    expect(conv.sending).toBe(false);
  });
});
