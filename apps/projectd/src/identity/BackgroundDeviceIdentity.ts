import { createHash, webcrypto } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
  private cachedIdentity: StoredDeviceIdentity | null = null

  constructor(helper?: NativeMacHelper) {
    this.helper = helper ?? new NativeMacHelper()
  }

  async getOrCreateIdentity(): Promise<StoredDeviceIdentity> {
    if (this.cachedIdentity) {
      return this.cachedIdentity
    }

    // 1. Try to load from macOS Keychain via native helper
    if (this.helper.isAvailable) {
      try {
        const json = await this.helper.loadIdentity()
        if (json) {
          const parsed = JSON.parse(json) as StoredDeviceIdentity
          if (parsed.identityKey && parsed.signingPrivateKeyJwk && parsed.privateKeyJwk) {
            this.cachedIdentity = parsed
            return parsed
          }
        }
      } catch (err) {
        console.warn("[BackgroundDeviceIdentity] Failed to read from Keychain:", err)
      }
    }

    // 2. Check fallback / existing local storage for migration
    const migrated = this.tryReadLocalDevIdentity()
    if (migrated) {
      if (this.helper.isAvailable) {
        try {
          await this.helper.saveIdentity(JSON.stringify(migrated))
          console.log("[BackgroundDeviceIdentity] Migrated existing identity to Keychain")
        } catch (err) {
          console.warn("[BackgroundDeviceIdentity] Could not persist migrated identity to Keychain:", err)
        }
      }
      this.cachedIdentity = migrated
      return migrated
    }

    // 3. Generate a new device identity
    const newIdentity = await this.generateNewIdentity()
    if (this.helper.isAvailable) {
      try {
        await this.helper.saveIdentity(JSON.stringify(newIdentity))
      } catch (err) {
        console.warn("[BackgroundDeviceIdentity] Could not save new identity to Keychain:", err)
      }
    }

    this.cachedIdentity = newIdentity
    return newIdentity
  }

  private tryReadLocalDevIdentity(): StoredDeviceIdentity | null {
    const candidatePaths = [
      path.join(os.homedir(), "Library/Application Support/Cozea/collab-keys/device-identity.insecure.json"),
      path.join(os.homedir(), ".cozea/device-identity.json"),
    ]

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const data = fs.readFileSync(p, "utf8")
          const parsed = JSON.parse(data)
          if (parsed?.identityKey && parsed?.signingPrivateKeyJwk) {
            return parsed as StoredDeviceIdentity
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
    return null
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
    const identity = targetIdentity ?? (await this.getOrCreateIdentity())

    // 1. Request challenge from cloud
    const challengeRes = await fetchFn(`${cloudBaseUrl}/auth/device/challenge`, {
      method: "POST",
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

    if (!challengeRes.ok) {
      const text = await challengeRes.text()
      throw new Error(`Cloud challenge request failed (${challengeRes.status}): ${text}`)
    }

    const { challenge } = (await challengeRes.json()) as { challenge: string }

    // 2. Sign challenge
    const signature = await this.signChallenge(challenge, identity)

    // 3. Exchange signature for session token
    const tokenRes = await fetchFn(`${cloudBaseUrl}/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityKey: identity.identityKey,
        challenge,
        signature: signature.signature,
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Cloud token exchange failed (${tokenRes.status}): ${text}`)
    }

    return (await tokenRes.json()) as CloudAuthResult
  }
}
