import { describe, expect, it } from "vitest";

import { buildDevAppPreviewUrl, parseDevAppPreviewUrl } from "../../shared/devAppPreviewProtocol";

const SOURCE_ID = "b".repeat(32);

describe("DevApp preview protocol", () => {
  it("gives every source an opaque isolated origin", () => {
    const url = buildDevAppPreviewUrl(SOURCE_ID, "dist/index.html");

    expect(url).toBe(`cozea-devapp://${SOURCE_ID}.dev/dist/index.html`);
    expect(parseDevAppPreviewUrl(url)).toEqual({
      sourceId: SOURCE_ID,
      assetPath: "dist/index.html",
    });
  });

  it("rejects published origins, invalid ids, and traversal", () => {
    expect(parseDevAppPreviewUrl(`cozea-devapp://${"c".repeat(64)}.release/index.html`)).toBeNull();
    expect(() => buildDevAppPreviewUrl("not-a-source", "index.html")).toThrow();
    expect(buildDevAppPreviewUrl(SOURCE_ID, "../outside.html")).toBe(
      `cozea-devapp://${SOURCE_ID}.dev/index.html`,
    );
  });
});
