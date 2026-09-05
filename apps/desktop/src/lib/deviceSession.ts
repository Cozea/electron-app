import { validateDeviceGatewayUrl } from "@shared/gatewayUrl"
import type { Id } from "../../../../convex/_generated/dataModel"
import type { PersonalWorkspaceMembership, User } from "@shared/types"

export interface DeviceSession {
  accessToken: string
  expiresAt: number
  convexUserId: Id<"users">
  user: User
  personalWorkspace: PersonalWorkspaceMembership
}

let cachedSession: DeviceSession | null = null
let pendingSession: Promise<DeviceSession> | null = null

function getAuthBaseUrl(): string {
  const configured = import.meta.env.VITE_AUTH_SERVER_URL || import.meta.env.VITE_COLLAB_BASE_URL
  if (!configured) {
    throw new Error("Device authentication server is not configured.")
  }
  return validateDeviceGatewayUrl(configured)
}

export function getDeviceGatewayBaseUrl(): string {
  return getAuthBaseUrl()
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as
    | T
    | { payload?: { message?: string }; message?: string }
    | null
  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object"
      ? payload as { payload?: { message?: string }; message?: string }
      : null
    const message = errorPayload?.payload?.message ?? errorPayload?.message
    throw new Error(message || `Device authentication failed (${response.status}).`)
  }
  return payload as T
}

async function issueDeviceSession(): Promise<DeviceSession> {
  const identity = await window.electronAPI.collab.ensureDeviceIdentity()
  if (
    !identity.signingPublicKeyJwk ||
    !identity.signingPublicKeyAlgorithm ||
    !identity.signingFingerprint
  ) {
    throw new Error("The device signing identity is unavailable.")
  }

  const baseUrl = getAuthBaseUrl()
  const challengeResponse = await fetch(`${baseUrl}/auth/device/challenge`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identityKey: identity.identityKey,
      deviceLabel: identity.deviceLabel,
      platform: identity.platform,
      encryptionPublicKeyJwk: identity.publicKeyJwk,
      encryptionPublicKeyAlgorithm: identity.publicKeyAlgorithm,
      encryptionFingerprint: identity.fingerprint,
      signingPublicKeyJwk: identity.signingPublicKeyJwk,
      signingPublicKeyAlgorithm: identity.signingPublicKeyAlgorithm,
      signingFingerprint: identity.signingFingerprint,
    }),
  })
  const { challenge } = await parseResponse<{ challenge: string }>(challengeResponse)
  const signed = await window.electronAPI.collab.signDeviceChallenge(challenge)
  if (signed.identityKey !== identity.identityKey) {
    throw new Error("The device identity changed during authentication.")
  }

  const completeResponse = await fetch(`${baseUrl}/auth/device/complete`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, signature: signed.signature }),
  })
  return await parseResponse<DeviceSession>(completeResponse)
}

export async function getDeviceSession(options: { force?: boolean } = {}): Promise<DeviceSession> {
  const now = Math.floor(Date.now() / 1000)
  if (!options.force && cachedSession && cachedSession.expiresAt > now + 60) {
    return cachedSession
  }
  if (!pendingSession) {
    pendingSession = issueDeviceSession()
      .then((session) => {
        cachedSession = session
        return session
      })
      .finally(() => {
        pendingSession = null
      })
  }
  return await pendingSession
}

export function clearDeviceSession(): void {
  cachedSession = null
  pendingSession = null
}

export async function createOrganizationRecoveryCode(
  organizationId: Id<"organizations">,
): Promise<{ recoveryCode: string; expiresAt: number }> {
  const session = await getDeviceSession()
  return await parseResponse<{ recoveryCode: string; expiresAt: number }>(await fetch(`${getAuthBaseUrl()}/auth/device/recovery/create`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ organizationId }),
  }))
}

export async function redeemOrganizationRecoveryCode(
  recoveryCode: string,
): Promise<{ organizationId: Id<"organizations">; recovered: true }> {
  const session = await getDeviceSession()
  return await parseResponse<{ organizationId: Id<"organizations">; recovered: true }>(await fetch(`${getAuthBaseUrl()}/auth/device/recovery/redeem`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ recoveryCode }),
  }))
}
