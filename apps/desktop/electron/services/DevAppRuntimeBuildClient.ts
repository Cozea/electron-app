import {
  DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES,
  type DevAppRuntimeBuildDescriptor,
} from "../../../../shared/devAppContainedRuntime"
import { createDevAppRuntimeSourceBundle } from "./DevAppRuntimeSourceBundle"
import { fetchDevAppGateway } from "./devAppGatewayFetch"

const REQUEST_TIMEOUT_MS = 60_000

function cleanGatewayUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new Error("The DevApp builder gateway must use HTTPS.")
  }
  return url.origin
}

function boundedSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function parseDescriptor(value: unknown): DevAppRuntimeBuildDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The DevApp builder returned an invalid response.")
  }
  const descriptor = value as Partial<DevAppRuntimeBuildDescriptor>
  if (
    typeof descriptor.buildId !== "string" ||
    typeof descriptor.projectId !== "string" ||
    typeof descriptor.uploadReservationId !== "string" ||
    typeof descriptor.sourceDigest !== "string" ||
    typeof descriptor.packageManifestDigest !== "string" ||
    !["queued", "building", "ready", "failed"].includes(descriptor.status ?? "") ||
    !Number.isFinite(descriptor.createdAt) ||
    !Number.isFinite(descriptor.updatedAt)
  ) {
    throw new Error("The DevApp builder returned an invalid response.")
  }
  return descriptor as DevAppRuntimeBuildDescriptor
}

/**
 * Reads the reason out of a gateway error body.
 *
 * The Worker answers with `{ type, payload: { code, message } }`, so a reader that only
 * checks the top level discards the one sentence that explains the failure and reports the
 * status code instead.
 */
function gatewayErrorMessage(body: unknown, status: number): string {
  const fallback = `Central DevApp build request failed (${status}).`
  if (!body || typeof body !== "object") return fallback
  const record = body as Record<string, unknown>
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : {}
  for (const candidate of [record.error, record.message, payload.message, payload.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return fallback
}

async function gatewayRequest(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<DevAppRuntimeBuildDescriptor> {
  if (!accessToken.trim() || accessToken.length > 16_384) {
    throw new Error("An authenticated device session is required for the central build.")
  }
  const response = await fetchDevAppGateway(
    url,
    {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${accessToken}`, ...init.headers },
    },
    "DevApp builder",
  )
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(gatewayErrorMessage(body, response.status).slice(0, 1_000))
  }
  return parseDescriptor(body)
}

export async function startDevAppRuntimeBuild(input: {
  projectRoot: string
  projectId: string
  uploadReservationId: string
  gatewayBaseUrl: string
  accessToken: string
}): Promise<DevAppRuntimeBuildDescriptor> {
  const projectId = boundedSegment(input.projectId, "The project ID")
  const reservationId = boundedSegment(input.uploadReservationId, "The upload reservation ID")
  const bundle = createDevAppRuntimeSourceBundle(input.projectRoot)
  if (bundle.zip.byteLength > DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES) {
    throw new Error("The central build source exceeds 128 MB.")
  }
  return await gatewayRequest(`${cleanGatewayUrl(input.gatewayBaseUrl)}/devapps/runtime-builds`, input.accessToken, {
    method: "POST",
    headers: {
      "content-type": "application/zip",
      "content-length": String(bundle.zip.byteLength),
      "x-cozea-project-id": projectId,
      "x-cozea-upload-reservation-id": reservationId,
      "x-cozea-source-digest": bundle.sourceDigest,
      "x-cozea-package-manifest-digest": bundle.packageManifestDigest,
    },
    body: Uint8Array.from(bundle.zip).buffer,
  })
}

export async function getDevAppRuntimeBuild(input: {
  buildId: string
  gatewayBaseUrl: string
  accessToken: string
}): Promise<DevAppRuntimeBuildDescriptor> {
  const buildId = boundedSegment(input.buildId, "The build ID")
  return await gatewayRequest(
    `${cleanGatewayUrl(input.gatewayBaseUrl)}/devapps/runtime-builds/${encodeURIComponent(buildId)}`,
    input.accessToken,
    { method: "GET" },
  )
}
