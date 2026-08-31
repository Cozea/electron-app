import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("workbench browser session-isolation parity", () => {
  it("records workspace partition isolation as a Cozea adaptation", () => {
    expect(getBrowserPortParityRequirement("session-isolation.workspace")).toMatchObject({
      id: "session-isolation.workspace",
      area: "session-isolation",
      status: "cozea-adapted",
    });
  });

  it.each(["session-isolation.ephemeral-release", "session-isolation.org-devapp"])(
    "preserves %s as a mandatory T3 port requirement",
    (id) => {
      expect(getBrowserPortParityRequirement(id)).toMatchObject({
        id,
        area: "session-isolation",
        status: "pending-t3-port",
      });
    },
  );
});
