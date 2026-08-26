/**
 * Optional OTLP HTTP export for substrate NDJSON spans (Track E follow-on).
 *
 * When `COZEA_OTLP_ENDPOINT` is set alongside `COZEA_OBS_NDJSON=1`, spans are
 * best-effort POSTed as OTLP JSON logs in addition to the local NDJSON file.
 */

import type { SubstrateNdjsonSpan } from "./ndjsonSpanWriter";

export interface OtlpExportResult {
  readonly exported: boolean;
  readonly status?: number;
  readonly error?: string;
}

function isOtlpEnabled(env: NodeJS.ProcessEnv): boolean {
  const endpoint = env.COZEA_OTLP_ENDPOINT?.trim();
  return Boolean(endpoint && endpoint.length > 0);
}

function resolveEndpoint(env: NodeJS.ProcessEnv): string | null {
  const raw = env.COZEA_OTLP_ENDPOINT?.trim();
  return raw && raw.length > 0 ? raw : null;
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
  const endpoint = resolveEndpoint(env);
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

export { isOtlpEnabled, resolveEndpoint as resolveOtlpEndpoint };
