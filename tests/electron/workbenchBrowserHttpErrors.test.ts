import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";

describe("workbench browser HTTP error parity", () => {
  it.each([
    "http-errors.transport-precedence",
    "http-errors.blank-error-document",
    "http-errors.framework-document",
  ])("preserves %s as a mandatory T3 port requirement", (id) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "http-errors",
      status: "pending-t3-port",
    });
  });
});
