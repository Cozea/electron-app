/**
 * OTLP HTTP export for substrate spans (Track E).
 *
 * When observability is enabled (`COZEA_OBS_NDJSON=1` by default) spans are
 * best-effort POSTed as OTLP JSON logs. Set `COZEA_OTLP_ENDPOINT` to override
 * the default local collector URL, or `COZEA_OTLP_ENDPOINT=0` to disable export.
 */

import { DEFAULT_OTLP_LOGS_ENDPOINT } from "../constants";
import { readSubstrateObsNdjsonFlags } from "../flags";

import type { SubstrateNdjsonSpan } from "./ndjsonSpanWriter";

export interface OtlpExportResult {
  readonly exported: boolean;
  readonly status?: number;
  readonly error?: string;
}

function isExplicitlyDisabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.COZEA_OTLP_ENDPOINT?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "off" || raw === "no";
}

/**
 * Whether OTLP export should run for the current env.
 * Enabled when obs NDJSON is on (default) and export is not explicitly disabled.
 */
export function isOtlpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isExplicitlyDisabled(env)) {
    return false;
  }
  const obs = readSubstrateObsNdjsonFlags(env);
  if (!obs.enabled) {
    const endpoint = env.COZEA_OTLP_ENDPOINT?.trim();
    return Boolean(endpoint && endpoint.length > 0 && !isExplicitlyDisabled(env));
  }
  return true;
}

/**
 * Resolve OTLP HTTP endpoint — explicit env wins, else default when obs is on.
 */
export function resolveOtlpEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isExplicitlyDisabled(env)) {
    return null;
  }
  const fromEnv = env.COZEA_OTLP_ENDPOINT?.trim();
  if (fromEnv && fromEnv.length > 0 && !isExplicitlyDisabled(env)) {
    return fromEnv;
  }
  if (readSubstrateObsNdjsonFlags(env).enabled) {
    return DEFAULT_OTLP_LOGS_ENDPOINT;
  }
  return null;
}

/**
 * Export one span to OTLP HTTP (JSON). Never throws — failures are returned.
 */
export async function exportSubstrateSpanToOtlp(
  span: SubstrateNdjsonSpan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OtlpExportResult> {
  if (!isOtlpEnabled(env)) {
    return { exported: false };
  }
  const endpoint = resolveOtlpEndpoint(env);
  if (!endpoint) {
    return { exported: false };
  }

  const body = {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "cozea-substrate" } }],
        },
        scopeLogs: [
          {
            scope: { name: "cozea.substrate" },
            logRecords: [
              {
                timeUnixNano: String(Date.parse(span.ts ?? new Date().toISOString()) * 1_000_000),
                severityText: "INFO",
                body: { stringValue: span.name },
                attributes: Object.entries(span.attrs ?? {}).map(([key, value]) => ({
                  key,
                  value: { stringValue: JSON.stringify(value) },
                })),
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { exported: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { exported: true, status: response.status };
  } catch (error) {
    return {
      exported: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
