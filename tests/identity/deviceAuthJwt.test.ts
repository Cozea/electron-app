import { describe, expect, it } from "vitest"

import {
  createDeviceChallengeToken,
  getDeviceAuthJwks,
  signDeviceAccessToken,
  verifyDeviceAccessToken,
  verifyDeviceChallengeSignature,
  verifyDeviceChallengeToken,
} from "../../cloudflare/worker/src/lib/jwt"
import type { DeviceAuthChallengeClaims, Env } from "../../cloudflare/worker/src/types"

const toBase64Url = (value: ArrayBuffer): string => Buffer.from(value).toString("base64url")

async function createTestEnv(): Promise<Env> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )
  return {
    COLLAB_JWT_SECRET: "test-secret-with-enough-entropy-for-fixtures",
    DEVICE_AUTH_CHALLENGE_SECRET: "separate-device-challenge-secret-for-fixtures",
    CONVEX_URL: "https://example.convex.cloud",
    AI_GATEWAY_SECRET: "server-secret",
    DEVICE_AUTH_ISSUER: "https://identity.example.test",
    DEVICE_AUTH_AUDIENCE: "cozea-convex",
    DEVICE_AUTH_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    DEVICE_AUTH_PUBLIC_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    DEVICE_AUTH_KEY_ID: "test-key-1",
    COLLAB_ROOM: {} as Env["COLLAB_ROOM"],
  }
}

describe("device proof-of-possession tokens", () => {
  it("verifies the device signature over a server-signed challenge", async () => {
    const env = await createTestEnv()
    const devicePair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )
    const now = Math.floor(Date.now() / 1000)
    const claims: DeviceAuthChallengeClaims = {
      typ: "cozea-device-challenge",
      nonce: "fixture-nonce",
      iat: now,
      exp: now + 120,
      identityKey: "czd_00000000000000000000000000",
      platform: "darwin",
      encryptionPublicKeyJwk: "{}",
      encryptionPublicKeyAlgorithm: "ECDH-P256",
      encryptionFingerprint: "encryption-fingerprint",
      signingPublicKeyJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", devicePair.publicKey)),
      signingPublicKeyAlgorithm: "ECDSA-P256-SHA256",
      signingFingerprint: "signing-fingerprint",
    }
    const challenge = await createDeviceChallengeToken(env, claims)
    const decoded = await verifyDeviceChallengeToken(env, challenge)
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      devicePair.privateKey,
      new TextEncoder().encode(challenge),
    )

    expect(decoded.identityKey).toBe(claims.identityKey)
    expect(decoded).not.toHaveProperty("deviceLabel")
    await expect(verifyDeviceChallengeSignature({
      challenge,
      signature: toBase64Url(signature),
      signingPublicKeyJwk: claims.signingPublicKeyJwk,
    })).resolves.toBe(true)
    await expect(verifyDeviceChallengeToken(env, `${challenge}x`)).rejects.toThrow()

    const wrongSignature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      devicePair.privateKey,
      new TextEncoder().encode("another challenge"),
    )
    await expect(verifyDeviceChallengeSignature({
      challenge,
      signature: toBase64Url(wrongSignature),
      signingPublicKeyJwk: claims.signingPublicKeyJwk,
    })).resolves.toBe(false)
  })

  it("issues an audience-bound ES256 access token for the device identity", async () => {
    const env = await createTestEnv()
    const identityKey = "czd_00000000000000000000000000"
    const issued = await signDeviceAccessToken(env, identityKey, 7)
    const verified = await verifyDeviceAccessToken(env, issued.token)

    expect(verified.sub).toBe(identityKey)
    expect(verified).not.toHaveProperty("device_id")
    expect(verified.aud).toBe("cozea-convex")
    expect(verified.key_version).toBe(7)
    expect(verified.jti.length).toBeGreaterThan(15)
    expect(verified.token_issued_at).toBe(verified.iat)
    expect(getDeviceAuthJwks(env).keys[0]).toMatchObject({
      alg: "ES256",
      use: "sig",
      kid: "test-key-1",
      kty: "EC",
      crv: "P-256",
    })
  })

  it("accepts an overlapping previous issuer key and publishes both keys", async () => {
    const previous = await createTestEnv()
    const current = await createTestEnv()
    current.DEVICE_AUTH_PREVIOUS_KEY_ID = previous.DEVICE_AUTH_KEY_ID
    current.DEVICE_AUTH_PREVIOUS_PUBLIC_JWK = previous.DEVICE_AUTH_PUBLIC_JWK
    current.DEVICE_AUTH_KEY_ID = "test-key-2"
    const priorToken = await signDeviceAccessToken(previous, "czd_00000000000000000000000000", 1)

    await expect(verifyDeviceAccessToken(current, priorToken.token)).resolves.toMatchObject({
      key_version: 1,
    })
    expect(getDeviceAuthJwks(current).keys.map((key) => key.kid)).toEqual([
      "test-key-2",
      "test-key-1",
    ])
  })
})
