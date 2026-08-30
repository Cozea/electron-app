import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  T3_BROWSER_PORT_PARITY_LEDGER,
  getBrowserPortParityRequirement,
} from "@shared/browserPortParityLedger";

describe("removed browser automation adapter", () => {
  it("has no preload or startup registration path", () => {
    const preload = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/electron/preload.ts"),
      "utf8",
    );
    const main = fs.readFileSync(path.join(process.cwd(), "apps/desktop/electron/main.ts"), "utf8");

    expect(preload).not.toContain("browserAutomation:");
    expect(main).not.toContain("registerBrowserAutomationHandlers");
  });

  it.each(["automation.loopback-navigation", "automation.snapshot", "automation.click-type"])(
    "preserves %s as a mandatory T3 port requirement",
    (id) => {
      expect(getBrowserPortParityRequirement(id)).toMatchObject({
        id,
        area: "automation",
        status: "pending-t3-port",
      });
    },
  );

  it("keeps every parity id unique", () => {
    const ids = T3_BROWSER_PORT_PARITY_LEDGER.map((requirement) => requirement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
