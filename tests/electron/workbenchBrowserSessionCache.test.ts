import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("workbench browser session-isolation parity", () => {
  it.each([
    "session-isolation.workspace",
    "session-isolation.ephemeral-release",
    "session-isolation.org-devapp",
  ])("preserves %s as a mandatory T3 port requirement", (id) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "session-isolation",
      status: "pending-t3-port",
    });
  });
});
