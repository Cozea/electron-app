import type { OrchestrationThreadActivity } from "@cozea/assistant-contracts";

export type AccountUsageLimitStatus = "available" | "warning" | "exhausted";

export interface AccountUsageLimitWindow {
  readonly key: string;
  readonly label: string;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly resetsAt: string | null;
  readonly status: AccountUsageLimitStatus;
}

export interface AccountUsageLimitSnapshot {
  readonly provider: "codex" | "claudeAgent";
  readonly windows: ReadonlyArray<AccountUsageLimitWindow>;
  readonly updatedAt: string;
}

export interface AccountUsageLimitBaseline {
  readonly provider: "codex" | "claudeAgent";
  readonly rateLimits: unknown;
  readonly updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function timestampToIso(value: unknown): string | null {
  const numeric = asFiniteNumber(value);
  if (numeric === null || numeric <= 0) return null;
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusFromRemaining(remainingPercentage: number | null): AccountUsageLimitStatus {
  if (remainingPercentage === null || remainingPercentage > 20) return "available";
  return remainingPercentage <= 0 ? "exhausted" : "warning";
}

function codexWindowLabel(durationMinutes: number | null, fallback: string): string {
  if (durationMinutes === null || durationMinutes <= 0) return fallback;
  if (durationMinutes >= 10_080 && durationMinutes % 10_080 === 0) return "Week";
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}h`;
  return `${Math.round(durationMinutes)}m`;
}

function codexWindow(
  value: unknown,
  key: string,
  fallbackLabel: string,
): AccountUsageLimitWindow | null {
  const record = asRecord(value);
  const rawUsedPercentage = asFiniteNumber(record?.usedPercent);
  if (rawUsedPercentage === null) return null;
  const usedPercentage = clampPercentage(rawUsedPercentage);
  const remainingPercentage = clampPercentage(100 - usedPercentage);
  return {
    key,
    label: codexWindowLabel(asFiniteNumber(record?.windowDurationMins), fallbackLabel),
    usedPercentage,
    remainingPercentage,
    resetsAt: timestampToIso(record?.resetsAt),
    status: statusFromRemaining(remainingPercentage),
  };
}

function mergeAvailableRecords(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!previous) return next;
  if (!next) return previous;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined) continue;
    const previousRecord = asRecord(merged[key]);
    const nextRecord = asRecord(value);
    merged[key] = previousRecord && nextRecord
      ? mergeAvailableRecords(previousRecord, nextRecord)
      : value;
  }
  return merged;
}

function codexSnapshotRecord(rawRateLimits: unknown): Record<string, unknown> | null {
  const envelope = asRecord(rawRateLimits);
  if (!envelope) return null;
  const byLimitId = asRecord(envelope.rateLimitsByLimitId);
  const codexBucket = asRecord(byLimitId?.codex);
  if (codexBucket) return codexBucket;
  return asRecord(envelope.rateLimits) ?? envelope;
}

function codexSnapshot(
  snapshot: Record<string, unknown> | null,
  updatedAt: string,
): AccountUsageLimitSnapshot | null {
  if (!snapshot) return null;

  const windows = [
    codexWindow(snapshot.primary, "codex-primary", "Primary"),
    codexWindow(snapshot.secondary, "codex-secondary", "Secondary"),
  ].filter((window): window is AccountUsageLimitWindow => window !== null);

  if (windows.length === 0) {
    const individualLimit = asRecord(snapshot.individualLimit);
    const remainingPercentage = asFiniteNumber(individualLimit?.remainingPercent);
    if (remainingPercentage === null) return null;
    const normalizedRemaining = clampPercentage(remainingPercentage);
    windows.push({
      key: "codex-spend-control",
      label:
        typeof snapshot.limitName === "string" && snapshot.limitName.trim()
          ? snapshot.limitName.trim()
          : "Usage",
      usedPercentage: clampPercentage(100 - normalizedRemaining),
      remainingPercentage: normalizedRemaining,
      resetsAt: timestampToIso(individualLimit?.resetsAt),
      status: statusFromRemaining(normalizedRemaining),
    });
  }

  return { provider: "codex", windows, updatedAt };
}

function claudeWindowLabel(rateLimitType: string | null): string {
  switch (rateLimitType) {
    case "five_hour":
      return "5h";
    case "seven_day":
      return "Week";
    case "seven_day_opus":
      return "Opus week";
    case "seven_day_sonnet":
      return "Sonnet week";
    case "seven_day_overage_included":
      return "Overage week";
    case "overage":
      return "Overage";
    default:
      return "Usage";
  }
}

function claudeStatus(value: unknown): AccountUsageLimitStatus {
  if (value === "rejected") return "exhausted";
  if (value === "allowed_warning") return "warning";
  return "available";
}

function claudeWindowFromInfo(
  info: Record<string, unknown>,
  rateLimitType: string | null,
): AccountUsageLimitWindow {
  const rawUtilization = asFiniteNumber(info.utilization);
  const explicitStatus = claudeStatus(info.status);
  const usedPercentage =
    rawUtilization === null
      ? explicitStatus === "exhausted"
        ? 100
        : null
      : clampPercentage(rawUtilization * 100);
  const remainingPercentage =
    usedPercentage === null ? null : clampPercentage(100 - usedPercentage);
  const derivedStatus = statusFromRemaining(remainingPercentage);

  return {
    key: `claude-${rateLimitType ?? "usage"}`,
    label: claudeWindowLabel(rateLimitType),
    usedPercentage,
    remainingPercentage,
    resetsAt: timestampToIso(info.resetsAt),
    status: explicitStatus === "available" ? derivedStatus : explicitStatus,
  };
}

function claudeWindows(rawRateLimits: unknown): ReadonlyArray<AccountUsageLimitWindow> {
  const message = asRecord(rawRateLimits);
  const info = asRecord(message?.rate_limit_info);
  if (!info) return [];

  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : null;
  const unifiedWindows = asRecord(info.unifiedWindows);
  if (!unifiedWindows) return [claudeWindowFromInfo(info, rateLimitType)];

  const orderedTypes = [
    "five_hour",
    "seven_day",
    "seven_day_opus",
    "seven_day_sonnet",
    "seven_day_overage_included",
    "overage",
  ];
  return Object.entries(unifiedWindows)
    .sort(([left], [right]) => {
      const leftRank = orderedTypes.indexOf(left);
      const rightRank = orderedTypes.indexOf(right);
      return (leftRank < 0 ? orderedTypes.length : leftRank) -
        (rightRank < 0 ? orderedTypes.length : rightRank);
    })
    .flatMap(([windowType, value]) => {
      const windowInfo = asRecord(value);
      if (!windowInfo || asFiniteNumber(windowInfo.utilization) === null) return [];
      return [
        claudeWindowFromInfo(
          {
            ...windowInfo,
            ...(windowType === rateLimitType ? { status: info.status } : {}),
          },
          windowType,
        ),
      ];
    });
}

function usageLimitPayload(activity: OrchestrationThreadActivity): unknown {
  return asRecord(activity.payload)?.rateLimits;
}

export function deriveLatestAccountUsageLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  baseline: AccountUsageLimitBaseline | null = null,
): AccountUsageLimitSnapshot | null {
  const limitActivities = activities.filter(
    (activity) => activity.kind === "account.rate-limits.updated",
  );
  const latestActivity = limitActivities.at(-1);
  if (!latestActivity && !baseline) return null;

  const latestClaudeWindows = latestActivity
    ? claudeWindows(usageLimitPayload(latestActivity))
    : [];
  if (baseline?.provider === "claudeAgent" || latestClaudeWindows.length > 0) {
    const windowsByKey = new Map<string, AccountUsageLimitWindow>();
    for (let index = limitActivities.length - 1; index >= 0; index -= 1) {
      const activity = limitActivities[index];
      if (!activity) continue;
      for (const window of claudeWindows(usageLimitPayload(activity))) {
        if (!windowsByKey.has(window.key)) windowsByKey.set(window.key, window);
      }
    }
    if (baseline?.provider === "claudeAgent") {
      for (const window of claudeWindows(baseline.rateLimits)) {
        if (!windowsByKey.has(window.key)) windowsByKey.set(window.key, window);
      }
    }
    const rank = (window: AccountUsageLimitWindow) => {
      if (window.label === "5h") return 0;
      if (window.label === "Week") return 1;
      return 2;
    };
    const windows = [...windowsByKey.values()].sort(
      (left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label),
    );
    return windows.length > 0
      ? {
          provider: "claudeAgent",
          windows,
          updatedAt: latestActivity?.createdAt ?? baseline!.updatedAt,
        }
      : null;
  }

  let mergedCodexSnapshot =
    baseline?.provider === "codex" ? codexSnapshotRecord(baseline.rateLimits) : null;
  for (const activity of limitActivities) {
    mergedCodexSnapshot = mergeAvailableRecords(
      mergedCodexSnapshot,
      codexSnapshotRecord(usageLimitPayload(activity)),
    );
  }
  return codexSnapshot(
    mergedCodexSnapshot,
    latestActivity?.createdAt ?? baseline?.updatedAt ?? new Date(0).toISOString(),
  );
}

export function formatUsageLimitReset(resetsAt: string | null, nowMs = Date.now()): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const remainingMinutes = Math.max(0, Math.ceil((resetMs - nowMs) / 60_000));
  if (remainingMinutes <= 1) return "Resets soon";
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `Resets in ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `Resets in ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `Resets in ${minutes}m`;
}
