import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { deriveLatestAccountUsageLimitSnapshot } from "@/features/assistant/lib/usageLimits"

const controller = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx",
  ),
  "utf8",
)

/**
 * A tile that has not run a turn yet has no rate-limit activity, so the only
 * source of usage is the provider snapshot's baseline. Claude was never handed
 * one, which is why its panel read "Not reported".
 */
describe("account usage baseline", () => {
  it("derives Claude windows from a baseline alone, with no activities", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot([], {
      provider: "claudeAgent",
      updatedAt: "2026-09-04T12:00:00.000Z",
      rateLimits: {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          resetsAt: 1_788_199_200,
          unifiedWindows: {
            five_hour: { utilization: 0.45, resetsAt: 1_788_199_200 },
            seven_day: { utilization: 0.74, resetsAt: 1_788_217_200 },
          },
        },
      },
    })

    expect(snapshot?.provider).toBe("claudeAgent")
    expect((snapshot?.windows ?? []).length).toBeGreaterThan(0)
  })

  it("hands the baseline to both providers, not only Codex", () => {
    expect(controller).toContain('selectedProvider === "claudeAgent"')
    // The provider is carried through rather than hardcoded to one of them.
    const block = controller.slice(controller.indexOf("const activeAccountUsage"))
    expect(block.slice(0, 900)).toContain("provider: selectedProvider")
  })
})
