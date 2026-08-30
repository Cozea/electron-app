import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("Dev Server preview script parity", () => {
  it.each(["automation.serialized-input", "automation.scroll-wait-bounds"])(
    "preserves %s as a mandatory T3 port requirement",
    (id) => {
      expect(getBrowserPortParityRequirement(id)).toMatchObject({
        id,
        area: "automation",
        status: "pending-t3-port",
      });
    },
  );
});
