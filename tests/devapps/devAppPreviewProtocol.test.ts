import { describe, expect, it } from "vitest";

import {
  buildDevAppPreviewUrl,
  evaluateDevAppPreviewNavigation,
  parseDevAppPreviewUrl,
} from "../../shared/devAppPreviewProtocol";

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

  it("confines a built preview to its source and opens public HTTPS externally", () => {
    const initial = buildDevAppPreviewUrl(SOURCE_ID, "dist/index.html");
    expect(
      evaluateDevAppPreviewNavigation(initial, buildDevAppPreviewUrl(SOURCE_ID, "asset.js")),
    ).toEqual({ allowed: true, reason: "same-preview" });
    expect(evaluateDevAppPreviewNavigation(initial, "https://docs.example.com")).toEqual({
      allowed: false,
      reason: "external-https",
    });
    expect(
      evaluateDevAppPreviewNavigation(initial, buildDevAppPreviewUrl("c".repeat(32), "index.html")),
    ).toEqual({ allowed: false, reason: "blocked" });
  });

  it("confines a dev-server preview to its declared loopback origin", () => {
    const initial = "http://localhost:5173/app";
    expect(evaluateDevAppPreviewNavigation(initial, "http://localhost:5173/next")).toEqual({
      allowed: true,
      reason: "same-dev-origin",
    });
    expect(evaluateDevAppPreviewNavigation(initial, "http://localhost:5174/")).toEqual({
      allowed: false,
      reason: "blocked",
    });
    expect(evaluateDevAppPreviewNavigation(initial, "http://127.0.0.1:5173/")).toEqual({
      allowed: false,
      reason: "blocked",
    });
    expect(evaluateDevAppPreviewNavigation(initial, "https://example.com/help")).toEqual({
      allowed: false,
      reason: "external-https",
    });
  });
});
