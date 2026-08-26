/**
 * Runtime observability feature flags.
 *
 * Flag name: `cozea.obs.ndjson` (Track E / Phase 6).
 * Default: off. Enable with env `COZEA_OBS_NDJSON=1|true|on|yes`.
 *
 * Optional OTLP (never required for CI / local smoke):
 * - `COZEA_OTLP_TRACES_URL` — when set with NDJSON on, completed spans are
 *   best-effort POSTed as OTLP/JSON to this endpoint
 * - `COZEA_OTLP_SERVICE_NAME` — defaults to `cozea-assistant-runtime`
 * - `COZEA_OTLP_EXPORT_INTERVAL_MS` — batch flush interval (default 5000)
 */

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

/** Canonical flag id from the T3 implementation plan. */
export const COZEA_OBS_NDJSON_FLAG = "cozea.obs.ndjson" as const;

export interface ObservabilityFlags {
  readonly ndjsonEnabled: boolean;
  readonly otlpTracesUrl: string | undefined;
  readonly otlpServiceName: string;
  readonly otlpExportIntervalMs: number;
}

export function readObservabilityFlags(
  env: NodeJS.ProcessEnv = process.env,
): ObservabilityFlags {
  const otlpUrl = env.COZEA_OTLP_TRACES_URL?.trim();
  const intervalRaw = env.COZEA_OTLP_EXPORT_INTERVAL_MS?.trim();
  const parsedInterval = intervalRaw ? Number(intervalRaw) : Number.NaN;

  return {
    ndjsonEnabled: parseBooleanFlag(env.COZEA_OBS_NDJSON, false),
    otlpTracesUrl: otlpUrl && otlpUrl.length > 0 ? otlpUrl : undefined,
    otlpServiceName: env.COZEA_OTLP_SERVICE_NAME?.trim() || "cozea-assistant-runtime",
    otlpExportIntervalMs:
      Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 5_000,
  };
}
