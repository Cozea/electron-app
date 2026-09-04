import { describe, expect, it } from "vitest"
import { EventId } from "@cozea/assistant-contracts"

import {
  deriveLatestAccountUsageLimitSnapshot,
  formatUsageLimitReset,
} from "@/features/assistant/lib/usageLimits"

const activity = (id: string, rateLimits: unknown, createdAt = "2026-09-01T01:00:00.000Z") => ({
  id: EventId.makeUnsafe(id),
  kind: "account.rate-limits.updated",
  summary: "Rate limits updated",
  tone: "info" as const,
  createdAt,
  turnId: null,
  payload: { rateLimits },
})

describe("account usage limit derivation", () => {
  it("derives Codex five-hour and weekly remaining usage", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot([
      activity("codex-limits", {
        rateLimits: {
          primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: 1_788_228_000 },
          secondary: {
            usedPercent: 71,
            windowDurationMins: 10_080,
            resetsAt: 1_788_652_800,
          },
        },
      }),
    ])

    expect(snapshot).toMatchObject({ provider: "codex" })
    expect(snapshot?.windows).toEqual([
      {
        key: "codex-primary",
        label: "5h",
        usedPercentage: 36,
        remainingPercentage: 64,
        resetsAt: "2026-09-01T02:00:00.000Z",
        status: "available",
      },
      {
        key: "codex-secondary",
        label: "Week",
        usedPercentage: 71,
        remainingPercentage: 29,
        resetsAt: "2026-09-06T00:00:00.000Z",
        status: "available",
      },
    ])
  })

  it("normalizes Claude utilization and retains distinct windows", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot([
      activity(
        "claude-week",
        {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "seven_day",
            utilization: 0.81,
            resetsAt: 1_788_652_800,
          },
        },
        "2026-09-01T00:59:00.000Z",
      ),
      activity("claude-five-hour", {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          utilization: 0.42,
          resetsAt: 1_788_228_000,
        },
      }),
    ])

    expect(snapshot).toMatchObject({ provider: "claudeAgent" })
    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercentage: 42, remainingPercentage: 58, status: "available" },
      { label: "Week", usedPercentage: 81, remainingPercentage: 19, status: "warning" },
    ])
  })

  it("uses Claude unified windows as the account-wide remaining usage", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot([
      activity("claude-unified", {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "seven_day",
          resetsAt: 1_788_217_200,
          unifiedWindows: {
            five_hour: { utilization: 0.05, resetsAt: 1_788_199_200 },
            seven_day: { utilization: 1.01, resetsAt: 1_788_217_200 },
          },
        },
      }),
    ])

    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercentage: 5, remainingPercentage: 95, status: "available" },
      { label: "Week", usedPercentage: 100, remainingPercentage: 0, status: "exhausted" },
    ])
  })

  it("merges sparse Codex updates into the authoritative account snapshot", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot(
      [
        activity("codex-primary-update", {
          rateLimits: {
            limitId: "codex",
            primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 1_788_228_000 },
          },
        }),
      ],
      {
        provider: "codex",
        updatedAt: "2026-09-01T00:30:00.000Z",
        rateLimits: {
          rateLimits: {
            primary: { usedPercent: 79, windowDurationMins: 300, resetsAt: 1_788_228_000 },
            secondary: {
              usedPercent: 22,
              windowDurationMins: 10_080,
              resetsAt: 1_788_652_800,
            },
          },
          rateLimitsByLimitId: {
            codex: {
              limitId: "codex",
              primary: {
                usedPercent: 79,
                windowDurationMins: 300,
                resetsAt: 1_788_228_000,
              },
              secondary: {
                usedPercent: 22,
                windowDurationMins: 10_080,
                resetsAt: 1_788_652_800,
              },
            },
          },
        },
      },
    )

    expect(snapshot?.windows).toMatchObject([
      { label: "5h", usedPercentage: 80, remainingPercentage: 20 },
      { label: "Week", usedPercentage: 22, remainingPercentage: 78 },
    ])
  })

  it("does not invent a Claude percentage when the SDK omits utilization", () => {
    const snapshot = deriveLatestAccountUsageLimitSnapshot([
      activity("claude-status-only", {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "five_hour",
          resetsAt: 1_788_228_000,
        },
      }),
    ])

    expect(snapshot?.windows[0]).toMatchObject({
      label: "5h",
      usedPercentage: null,
      remainingPercentage: null,
      status: "available",
    })
  })

  it("formats the reset as the shortest useful relative time", () => {
    expect(
      formatUsageLimitReset("2026-09-01T02:00:00.000Z", Date.parse("2026-09-01T00:30:00.000Z")),
    ).toBe("Resets in 1h 30m")
  })
})
