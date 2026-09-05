import { expect, it } from "vitest";
import { nonImageAttachmentLabels } from "@/features/assistant/chat/historyAttachments";
it("keeps file and future attachment names readable while ignoring malformed entries", () => {
  expect(
    nonImageAttachmentLabels([
      { type: "image", name: "photo" },
      { type: "file", name: "brief.pdf" },
      { type: "future", name: "data" },
      null,
      { type: "future" },
    ]),
  ).toEqual(["brief.pdf", "data", "Attachment"]);
});
