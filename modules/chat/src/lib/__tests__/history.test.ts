import { describe, it, expect } from "vitest";
import { composerHistory } from "../history";
import type { Message } from "../../types";

function user(content: string): Message {
  return { messageId: content, conversationId: "c", role: "user", content };
}
function assistant(content: string): Message {
  return { messageId: "a-" + content, conversationId: "c", role: "assistant", content };
}

describe("composerHistory", () => {
  it("只取 user 消息,保持时序(0=最老)", () => {
    const msgs = [user("一"), assistant("回复"), user("二"), user("三")];
    expect(composerHistory(msgs)).toEqual(["一", "二", "三"]);
  });

  it("跳过空白 user 内容", () => {
    const msgs = [user("有"), user("   "), user("")];
    expect(composerHistory(msgs)).toEqual(["有"]);
  });

  it("无 user 消息返回空数组", () => {
    expect(composerHistory([assistant("只有助手")])).toEqual([]);
  });
});
