import { describe, expect, it } from "vitest";

import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  isScrollContainerNearBottom,
  scrollDistanceFromBottom,
  scrollTopForBottomDistance,
} from "@/features/assistant/chat/chat-scroll";

describe("chat bottom anchoring", () => {
  it("treats the configured tail threshold as following", () => {
    const position = { scrollTop: 536, clientHeight: 400, scrollHeight: 1000 };
    expect(scrollDistanceFromBottom(position)).toBe(AUTO_SCROLL_BOTTOM_THRESHOLD_PX);
    expect(isScrollContainerNearBottom(position)).toBe(true);
    expect(isScrollContainerNearBottom({ ...position, scrollTop: 535 })).toBe(false);
  });

  it("preserves a reader's exact bottom distance when scroll height grows", () => {
    expect(scrollTopForBottomDistance({ clientHeight: 400, scrollHeight: 1160 }, 32)).toBe(728);
  });

  it("preserves the same bottom distance while the composer inset shrinks", () => {
    expect(scrollTopForBottomDistance({ clientHeight: 400, scrollHeight: 920 }, 32)).toBe(488);
  });

  it("never returns a negative scroll position", () => {
    expect(scrollTopForBottomDistance({ clientHeight: 500, scrollHeight: 300 }, 40)).toBe(0);
  });
});
