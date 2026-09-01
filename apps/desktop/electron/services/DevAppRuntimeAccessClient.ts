import type { DevAppRuntimeRegistryAuth } from "../../../../shared/devAppContainedRuntime"

const REQUEST_TIMEOUT_MS = 30_000
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function cleanGatewayUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new Error("The DevApp runtime gateway must use HTTPS.")
  }
  return url.origin
}

function assertSegment(value: string, label: string): string {
  if (!SEGMENT.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

export async function requestDevAppRuntimeRegistryAuth(input: {
  gatewayBaseUrl: string
  accessToken: string
  organizationId: string
  publicationId: string
  releaseId: string
  manifestDigest: string
}): Promise<DevAppRuntimeRegistryAuth> {
  if (!input.accessToken.trim() || input.accessToken.length > 16_384) {
    throw new Error("An authenticated device session is required to start this DevApp.")
  }
  if (!SHA256_DIGEST.test(input.manifestDigest)) {
    throw new Error("The DevApp runtime manifest digest is invalid.")
  }
  const response = await fetch(`${cleanGatewayUrl(input.gatewayBaseUrl)}/devapps/runtime-pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      organizationId: assertSegment(input.organizationId, "The organization ID"),
      publicationId: assertSegment(input.publicationId, "The publication ID"),
      releaseId: assertSegment(input.releaseId, "The release ID"),
      manifestDigest: input.manifestDigest,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null) as Partial<DevAppRuntimeRegistryAuth> | null
  if (!response.ok) {
    throw new Error(`The private DevApp image could not be authorized (${response.status}).`)
  }
  if (
    body?.scheme !== "bearer" ||
    typeof body.token !== "string" ||
    !body.token ||
    body.token.length > 16_384 ||
    typeof body.expiresAt !== "number" ||
    body.expiresAt <= Date.now()
  ) {
    throw new Error("The DevApp image registry returned invalid authorization.")
  }
  return body as DevAppRuntimeRegistryAuth
}
