import { describe, expect, it } from "vitest";

import { isExternallyOpenableBrowserUrl } from "@/features/projects/browser/urlInput";
import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("browser URL policy during blackout", () => {
  it("allows public and loopback HTTP(S) external opening", () => {
    expect(isExternallyOpenableBrowserUrl("http://localhost:5173/")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("https://127.0.0.1:3000/app")).toBe(true);
    expect(isExternallyOpenableBrowserUrl("https://example.com")).toBe(true);
  });

  it("rejects custom, file, data, script, and malformed URLs", () => {
    expect(isExternallyOpenableBrowserUrl("cozea-devapp://release/index.html")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("file:///tmp/x")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("data:text/plain,hello")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isExternallyOpenableBrowserUrl("")).toBe(false);
  });

  it("preserves loopback-only agent navigation as a T3 port requirement", () => {
    expect(getBrowserPortParityRequirement("automation.loopback-navigation")).toMatchObject({
      area: "automation",
      status: "pending-t3-port",
    });
  });
});
