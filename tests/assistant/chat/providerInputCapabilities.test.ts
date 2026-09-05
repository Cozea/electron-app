import { expect, it } from "vitest";
import { providerImageRejection } from "@/features/assistant/chat/providerInputCapabilities";
it("enforces Antigravity MIME and aggregate limits before uploading", () => {
  expect(
    providerImageRejection("antigravity", [{ mimeType: "image/png", sizeBytes: 10 * 1024 * 1024 }]),
  ).toBeNull();
  expect(providerImageRejection("antigravity", [{ mimeType: "image/gif", sizeBytes: 5 }])).toMatch(
    /BMP/,
  );
  expect(
    providerImageRejection(
      "antigravity",
      Array.from({ length: 6 }, () => ({ mimeType: "image/png", sizeBytes: 10 * 1024 * 1024 })),
    ),
  ).toMatch(/50 MiB/);
  expect(providerImageRejection("codex", [{ mimeType: "image/gif", sizeBytes: 5 }])).toBeNull();
});
