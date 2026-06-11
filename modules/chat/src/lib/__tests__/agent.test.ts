import { describe, it, expect } from "vitest";
import { hueFromId, displayName, avatarLetter } from "../agent";

describe("hueFromId", () => {
  it("同一 id 稳定,落在 0-359", () => {
    const h = hueFromId("agent-x");
    expect(h).toBe(hueFromId("agent-x"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
  it("空串得 0", () => {
    expect(hueFromId("")).toBe(0);
  });
  it("超长 id 不溢出(无符号截断)", () => {
    const h = hueFromId("x".repeat(500));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe("displayName", () => {
  it("有 name 用 name(去空白)", () => {
    expect(displayName({ id: "i1", name: "  店长  " })).toBe("店长");
  });
  it("name 空白/缺省回退 id", () => {
    expect(displayName({ id: "i1", name: "   " })).toBe("i1");
    expect(displayName({ id: "i1" })).toBe("i1");
  });
});

describe("avatarLetter", () => {
  it("取显示名首字", () => {
    expect(avatarLetter({ id: "i1", name: "店长助理" })).toBe("店");
  });
  it("emoji 名取整个 code point", () => {
    expect(avatarLetter({ id: "i1", name: "🤖bot" })).toBe("🤖");
  });
  it("name 缺省时取 id 首字", () => {
    expect(avatarLetter({ id: "agent" })).toBe("a");
  });
});
