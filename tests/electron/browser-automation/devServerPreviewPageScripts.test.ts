import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("Dev Server preview script parity", () => {
  it.each(["automation.serialized-input", "automation.scroll-wait-bounds"])(
    "records %s as completed T3 parity",
    (id) => {
      expect(getBrowserPortParityRequirement(id)).toMatchObject({
        id,
        area: "automation",
        status: "ported",
      });
    },
  );
});
