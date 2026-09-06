import { describe, expect, it } from "vitest";

import { estimateTimelineAttachmentGalleryHeight } from "@/features/assistant/chat/timelineHeight";

describe("timeline attachment height estimates", () => {
  it("matches the fixed 96px attachment card geometry", () => {
    // h-24 thumbnail + mb-1; there is no inter-row gap for one row.
    expect(estimateTimelineAttachmentGalleryHeight("user", 1, 720)).toBe(100);
  });

  it("uses the real available user-bubble width when estimating wrapped galleries", () => {
    expect(estimateTimelineAttachmentGalleryHeight("user", 6, 720)).toBe(204);
    expect(estimateTimelineAttachmentGalleryHeight("user", 6, 360)).toBe(308);
  });

  it("uses the full assistant content width for assistant galleries", () => {
    expect(estimateTimelineAttachmentGalleryHeight("assistant", 6, 720)).toBe(204);
  });
});
