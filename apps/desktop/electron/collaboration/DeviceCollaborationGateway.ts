import { ensureCollabDeviceIdentity, signCollabDeviceChallenge } from "../collabKeys"
import { getTrustedDeviceGatewayBaseUrl } from "../services/DeviceGatewayPolicy"

interface DeviceToken { accessToken: string; expiresAt: number }
export class CollaborationGatewayUnavailable extends Error {}

/** Memory-only gateway authority, obtained with this device's OS-backed signer. */
export class DeviceCollaborationGateway {
  private token: DeviceToken | null = null
  private pending: Promise<DeviceToken> | null = null

  private async request<T>(route: string, body: unknown, token?: string): Promise<T> {
    const response = await fetch(`${getTrustedDeviceGatewayBaseUrl()}${route}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }).catch(() => { throw new CollaborationGatewayUnavailable("Gateway is unreachable; offline recovery is available for previously joined sessions") })
    if (!response.ok) {
      if (response.status === 401) this.token = null
      if (response.status >= 500) throw new CollaborationGatewayUnavailable("Gateway is temporarily unavailable")
      throw new Error(`Collaboration authorization request failed (${response.status}); reconnect or check device access`)
    }
    return await response.json() as T
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() / 1000 + 60) return this.token.accessToken
    if (!this.pending) this.pending = this.authenticate().then(value => { this.token = value; return value }).finally(() => { this.pending = null })
    return (await this.pending).accessToken
  }

  private async authenticate(): Promise<DeviceToken> {
    const identity = await ensureCollabDeviceIdentity()
    const { challenge } = await this.request<{ challenge: string }>("/auth/device/challenge", {
      identityKey: identity.identityKey, deviceLabel: identity.deviceLabel, platform: identity.platform,
      encryptionPublicKeyJwk: identity.publicKeyJwk, encryptionPublicKeyAlgorithm: identity.publicKeyAlgorithm, encryptionFingerprint: identity.fingerprint,
      signingPublicKeyJwk: identity.signingPublicKeyJwk, signingPublicKeyAlgorithm: identity.signingPublicKeyAlgorithm, signingFingerprint: identity.signingFingerprint,
    })
    const signed = await signCollabDeviceChallenge(challenge)
    if (signed.identityKey !== identity.identityKey) throw new Error("Device identity changed during authentication")
    const result = await this.request<DeviceToken>("/auth/device/complete", { challenge, signature: signed.signature })
    if (typeof result.accessToken !== "string" || !result.accessToken || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() / 1000) throw new Error("Invalid device authorization response")
    return { accessToken: result.accessToken, expiresAt: result.expiresAt }
  }

  async post<T>(route: string, body: unknown): Promise<T> {
    return this.request(route, body, await this.accessToken())
  }
}
