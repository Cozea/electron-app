import { describe, expect, it } from "vitest";
import { EventId } from "@cozea/assistant-contracts";

import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "@/features/assistant/lib/contextWindow";

describe("context window derivation", () => {
  it("calculates GPT-5.6's 1.05M context exactly", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        id: EventId.makeUnsafe("usage-1"),
        kind: "context-window.updated",
        summary: "Context updated",
        tone: "info",
        createdAt: "2026-08-28T00:00:00.000Z",
        turnId: null,
        payload: {
          usedTokens: 105_000,
          maxTokens: 1_050_000,
          compactsAutomatically: true,
          autoCompactThreshold: 900_000,
        },
      },
    ]);

    expect(snapshot).toMatchObject({
      usedPercentage: 10,
      remainingTokens: 945_000,
      remainingPercentage: 90,
      autoCompactThreshold: 900_000,
    });
    expect(formatContextWindowTokens(1_050_000)).toBe("1.05m");
  });

  it("keeps a valid zero-token snapshot", () => {
    expect(
      deriveLatestContextWindowSnapshot([
        {
          id: EventId.makeUnsafe("usage-zero"),
          kind: "context-window.updated",
          summary: "Context updated",
          tone: "info",
          createdAt: "2026-08-28T00:00:00.000Z",
          turnId: null,
          payload: { usedTokens: 0, maxTokens: 1_050_000 },
        },
      ]),
    ).toMatchObject({ usedTokens: 0, usedPercentage: 0, remainingTokens: 1_050_000 });
  });
});
