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

  it("records ephemeral Dev Server and Project DevApp release cleanup as a Cozea adaptation", () => {
    expect(getBrowserPortParityRequirement("session-isolation.ephemeral-release")).toMatchObject({
      id: "session-isolation.ephemeral-release",
      area: "session-isolation",
      status: "cozea-adapted",
    });
  });

  it("records persistent publication-scoped Org DevApp sessions as a Cozea adaptation", () => {
    expect(getBrowserPortParityRequirement("session-isolation.org-devapp")).toMatchObject({
      id: "session-isolation.org-devapp",
      area: "session-isolation",
      status: "cozea-adapted",
    });
  });
});
