import { BackgroundIdentityError } from "./BackgroundIdentityError"
import { createHash, webcrypto } from "node:crypto"

import { NativeMacHelper } from "../native/NativeMacHelper"

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

export interface StoredDeviceIdentity {
  schemaVersion: 3
  identityKey: string
  platform: string
  publicKeyAlgorithm: "ECDH-P256"
  fingerprint: string
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  signingPublicKeyAlgorithm: "ECDSA-P256-SHA256"
  signingFingerprint: string
  signingPublicKeyJwk: JsonWebKey
  signingPrivateKeyJwk: JsonWebKey
  createdAt: number
}

export interface DeviceChallengeSignature {
  identityKey: string
  algorithm: "ECDSA-P256-SHA256"
  signature: string
}

export interface CloudAuthResult {
  token: string
  principalId: string
  expiresAt: number
}

function publicJwkFingerprint(publicKeyJwk: JsonWebKey): string {
  return createHash("sha256")
    .update(JSON.stringify(publicKeyJwk))
    .digest("hex")
    .slice(0, 32)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

export class BackgroundDeviceIdentityManager {
  readonly helper: NativeMacHelper
  private readonly authCache = new Map<string, CloudAuthResult>()

  constructor(helper?: NativeMacHelper) {
    this.helper = helper ?? new NativeMacHelper()
  }

  /** Runtime identity is the desktop's existing principal, never a newly generated fallback. */
  async loadExistingIdentity(): Promise<StoredDeviceIdentity> {
    let json: string | null
    try { json = await this.helper.loadIdentity() } catch {
      throw new BackgroundIdentityError("KEYCHAIN_UNAVAILABLE", "Cozea cannot read its saved device keys. Unlock this Mac and its login Keychain, then retry. If it persists, reopen Cozea.")
    }
    if (!json) throw new BackgroundIdentityError("IDENTITY_NOT_AUTHORIZED", "Open Cozea to authorize this profile's existing background identity, then retry. Retained session data has been kept.")
    let identity: StoredDeviceIdentity
    try { identity = JSON.parse(json) as StoredDeviceIdentity } catch {
      throw new BackgroundIdentityError("IDENTITY_INVALID", "The saved background identity cannot be read. Reopen Cozea to authorize its existing device identity. Retained session data has been kept.")
    }
    if (!identity || identity.schemaVersion !== 3 || !/^czd_[a-f0-9]+$/.test(identity.identityKey) ||
        !identity.signingPrivateKeyJwk?.d || !identity.privateKeyJwk?.d) {
      throw new BackgroundIdentityError("IDENTITY_INVALID", "The saved background identity is invalid. Reopen Cozea to authorize its existing device identity. Retained session data has been kept.")
    }
    return identity
  }

  async generateNewIdentity(): Promise<StoredDeviceIdentity> {
    const encKeyPair = await subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"],
    )
    const publicKeyJwk = await subtle.exportKey("jwk", encKeyPair.publicKey)
    const privateKeyJwk = await subtle.exportKey("jwk", encKeyPair.privateKey)

    const signKeyPair = await subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )
    const signingPublicKeyJwk = await subtle.exportKey("jwk", signKeyPair.publicKey)
    const signingPrivateKeyJwk = await subtle.exportKey("jwk", signKeyPair.privateKey)

    const encFingerprint = publicJwkFingerprint(publicKeyJwk)
    const signFingerprint = publicJwkFingerprint(signingPublicKeyJwk)

    // Identity key format czd_<hash>
    const identityKey = `czd_${createHash("sha256").update(encFingerprint + signFingerprint).digest("hex").slice(0, 24)}`

    return {
      schemaVersion: 3,
      identityKey,
      platform: "darwin",
      publicKeyAlgorithm: "ECDH-P256",
      fingerprint: encFingerprint,
      publicKeyJwk,
      privateKeyJwk,
      signingPublicKeyAlgorithm: "ECDSA-P256-SHA256",
      signingFingerprint: signFingerprint,
      signingPublicKeyJwk,
      signingPrivateKeyJwk,
      createdAt: Date.now(),
    }
  }

  async signChallenge(
    challenge: string,
    identity: StoredDeviceIdentity,
  ): Promise<DeviceChallengeSignature> {
    // If native helper is available and private key JWK contains scalar 'd', we can use Swift CryptoKit or WebCrypto
    if (this.helper.isAvailable && identity.signingPrivateKeyJwk.d) {
      try {
        const sig = await this.helper.signChallenge(challenge, identity.signingPrivateKeyJwk.d)
        return {
          identityKey: identity.identityKey,
          algorithm: "ECDSA-P256-SHA256",
          signature: sig,
        }
      } catch {
        // Fall back to WebCrypto
      }
    }

    const signingKey = await subtle.importKey(
      "jwk",
      identity.signingPrivateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    )
    const signature = await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      encoder.encode(challenge),
    )

    return {
      identityKey: identity.identityKey,
      algorithm: "ECDSA-P256-SHA256",
      signature: bytesToBase64Url(new Uint8Array(signature)),
    }
  }

  async authenticateWithCloud(
    cloudBaseUrl: string,
    fetchFn: typeof fetch = fetch,
    targetIdentity?: StoredDeviceIdentity,
  ): Promise<CloudAuthResult> {
    const identity = targetIdentity ?? (await this.loadExistingIdentity())
    const cacheKey = `${cloudBaseUrl}:${identity.identityKey}`
    const cached = this.authCache.get(cacheKey)
    if (cached && cached.expiresAt * 1000 > Date.now() + 60_000) return cached

    // 1. Request challenge from cloud
    const challengeRes = await fetchFn(`${cloudBaseUrl}/auth/device/challenge`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityKey: identity.identityKey,
        platform: identity.platform,
        encryptionPublicKeyAlgorithm: identity.publicKeyAlgorithm,
        encryptionFingerprint: identity.fingerprint,
        encryptionPublicKeyJwk: JSON.stringify(identity.publicKeyJwk),
        signingPublicKeyAlgorithm: identity.signingPublicKeyAlgorithm,
        signingFingerprint: identity.signingFingerprint,
        signingPublicKeyJwk: JSON.stringify(identity.signingPublicKeyJwk),
      }),
    })

    if (challengeRes.status === 401 || challengeRes.status === 403) {
      throw new BackgroundIdentityError("DEVICE_AUTH_REJECTED", "The service rejected this device identity. Verify access online before reopening the session.")
    }
    if (!challengeRes.ok) {
      throw new Error(`Cloud challenge request failed (${challengeRes.status})`)
    }

    const { challenge } = (await challengeRes.json()) as { challenge: string }

    // 2. Sign challenge
    const signature = await this.signChallenge(challenge, identity)

    // 3. Exchange signature for session token
    const tokenRes = await fetchFn(`${cloudBaseUrl}/auth/device/complete`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityKey: identity.identityKey,
        challenge,
        signature: signature.signature,
      }),
    })

    if (tokenRes.status === 401 || tokenRes.status === 403) {
      throw new BackgroundIdentityError("DEVICE_AUTH_REJECTED", "The service rejected this device identity. Verify access online before reopening the session.")
    }
    if (!tokenRes.ok) {
      throw new Error(`Cloud token exchange failed (${tokenRes.status})`)
    }

    const response = await tokenRes.json() as { accessToken: string; expiresAt: number; principalId: string }
    if (!response.accessToken || !response.principalId || !Number.isFinite(response.expiresAt)) {
      throw new Error("Device authentication returned an invalid session")
    }
    const result = { token: response.accessToken, expiresAt: response.expiresAt, principalId: response.principalId }
    this.authCache.set(cacheKey, result)
    return result
  }
}
