import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  T3_BROWSER_PORT_PARITY_LEDGER,
  getBrowserPortParityRequirement,
} from "@shared/browserPortParityLedger";

describe("T3 browser automation cutover", () => {
  it("has no preload or startup registration path", () => {
    const preload = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/electron/preload.ts"),
      "utf8",
    );
    const main = fs.readFileSync(path.join(process.cwd(), "apps/desktop/electron/main.ts"), "utf8");

    expect(preload).not.toContain("browserAutomation:");
    expect(main).not.toContain("registerBrowserAutomationHandlers");
  });

  it.each([
    ["automation.loopback-navigation", "cozea-adapted"],
    ["automation.snapshot", "ported"],
    ["automation.click-type", "ported"],
  ] as const)("records %s as completed parity", (id, status) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "automation",
      status,
    });
  });

  it("keeps every parity id unique", () => {
    const ids = T3_BROWSER_PORT_PARITY_LEDGER.map((requirement) => requirement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
