import { describe, expect, it } from "vitest";
import { reuseEqualMap } from "@/features/assistant/chat/useChatRenderStability";

describe("chat metadata identity", () => {
  it("retains checkpoint metadata through text-only updates", () => {
    const previous = new Map([["user", 2]]);
    expect(reuseEqualMap(previous, new Map([["user", 2]]))).toBe(previous);
  });
  it("adopts same-size authoritative changes, removals and different keys", () => {
    const previous = new Map([["user", 2]]);
    for (const next of [
      new Map([["user", 3]]),
      new Map([["other", 2]]),
      new Map<string, number>(),
    ]) {
      expect(reuseEqualMap(previous, next)).toBe(next);
    }
  });
  it("does not conflate missing keys with stored undefined", () => {
    const previous = new Map([["a", undefined]]);
    const next = new Map([["b", undefined]]);
    expect(reuseEqualMap(previous, next)).toBe(next);
  });
});
