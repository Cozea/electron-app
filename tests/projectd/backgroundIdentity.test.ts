import { webcrypto } from "node:crypto"
import { describe, expect, it } from "vitest"

import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { NativeMacHelper } from "../../apps/projectd/src/native/NativeMacHelper"

const subtle = webcrypto.subtle

function base64UrlToBytes(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/")
  while (b64.count % 4 !== 0 && b64.length % 4 !== 0) {
    b64 += "="
  }
  return new Uint8Array(Buffer.from(b64, "base64"))
}

describe("P03 macOS helper, Keychain identity, and cloud auth", () => {
  const helper = new NativeMacHelper()

  describe("NativeMacHelper CLI operations", () => {
    it("probes volume capabilities via native helper", async () => {
      expect(helper.isAvailable).toBe(true)
      const res = await helper.probeVolume("/")
      expect(res.path).toBe("/")
      expect(typeof res.isCaseSensitive).toBe("boolean")
      expect(typeof res.supportsCloning).toBe("boolean")
      expect(typeof res.fileSystemType).toBe("string")
    })

    it("queries LaunchAgent status via native helper", async () => {
      expect(helper.isAvailable).toBe(true)
      const res = await helper.getLaunchAgentStatus()
      expect(res.plistName).toBe("app.cozea.projectd.plist")
      expect(typeof res.isLoaded).toBe("boolean")
      expect(["enabled", "disabled", "not_registered", "running", "requires_approval", "not_found"]).toContain(
        res.status,
      )
    })

    it("saves, loads, and deletes test identity in macOS Keychain", async () => {
      expect(helper.isAvailable).toBe(true)

      const testPayload = JSON.stringify({
        testId: `test_${Date.now()}`,
        identityKey: "czd_test_keychain_123",
        secret: "my_secret_token",
      })

      // 1. Save
      await helper.saveIdentity(testPayload)

      // 2. Load and verify
      const loaded = await helper.loadIdentity()
      expect(loaded).toBe(testPayload)

      // 3. Clean up
      await helper.deleteIdentity()
      const afterDelete = await helper.loadIdentity()
      expect(afterDelete).toBeNull()
    })

    it("proves native Swift CryptoKit and Node WebCrypto challenge signing parity", async () => {
      expect(helper.isAvailable).toBe(true)

      // Generate ECDSA keypair in WebCrypto
      const keyPair = await subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      )
      const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey)
      const _publicJwk = await subtle.exportKey("jwk", keyPair.publicKey)

      expect(privateJwk.d).toBeDefined()

      const challenge = `challenge_nonce_${Date.now()}_abc123`

      // 1. Sign via Swift helper (CryptoKit)
      const swiftSigBase64Url = await helper.signChallenge(challenge, privateJwk.d!)
      expect(typeof swiftSigBase64Url).toBe("string")

      // 2. Verify Swift signature using WebCrypto publicKey
      const verifiedSwift = await subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.publicKey,
        base64UrlToBytes(swiftSigBase64Url),
        new TextEncoder().encode(challenge),
      )
      expect(verifiedSwift).toBe(true)

      // 3. Sign via WebCrypto
      const nodeSig = await subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        new TextEncoder().encode(challenge),
      )
      const nodeSigBase64Url = Buffer.from(nodeSig).toString("base64url")

      // 4. Verify Node signature using WebCrypto publicKey
      const verifiedNode = await subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.publicKey,
        base64UrlToBytes(nodeSigBase64Url),
        new TextEncoder().encode(challenge),
      )
      expect(verifiedNode).toBe(true)
    })
  })

  describe("BackgroundDeviceIdentityManager", () => {
    it("generates, signs challenge, and ensures stable identity key", async () => {
      const manager = new BackgroundDeviceIdentityManager(helper)
      const identity1 = await manager.generateNewIdentity()

      expect(identity1.identityKey).toMatch(/^czd_[a-f0-9]{24}$/)
      expect(identity1.platform).toBe("darwin")
      expect(identity1.publicKeyAlgorithm).toBe("ECDH-P256")
      expect(identity1.signingPublicKeyAlgorithm).toBe("ECDSA-P256-SHA256")

      const challenge = `cloud_challenge_${Date.now()}`
      const sig = await manager.signChallenge(challenge, identity1)

      expect(sig.identityKey).toBe(identity1.identityKey)
      expect(sig.algorithm).toBe("ECDSA-P256-SHA256")
      expect(typeof sig.signature).toBe("string")

      // Verify the signature against the identity's signing public key
      const importedPublicKey = await subtle.importKey(
        "jwk",
        identity1.signingPublicKeyJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      )

      const isValid = await subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        importedPublicKey,
        base64UrlToBytes(sig.signature),
        new TextEncoder().encode(challenge),
      )
      expect(isValid).toBe(true)
    })

    it("authenticates with cloud challenge-response protocol with Electron closed", async () => {
      const manager = new BackgroundDeviceIdentityManager(helper)
      const identity = await manager.generateNewIdentity()

      const testChallenge = "server_issued_challenge_nonce_xyz"
      const expectedToken = "jwt_device_token_abc_123"

      // Mock cloudflare worker auth endpoints
      const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString()
        if (url.endsWith("/auth/device/challenge")) {
          const body = JSON.parse(init?.body as string)
          expect(body.identityKey).toBe(identity.identityKey)
          return new Response(JSON.stringify({ challenge: testChallenge, expiresAt: Date.now() + 120_000 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        if (url.endsWith("/auth/device/token")) {
          const body = JSON.parse(init?.body as string)
          expect(body.identityKey).toBe(identity.identityKey)
          expect(body.challenge).toBe(testChallenge)

          // Verify signature in mock server
          const importedPublicKey = await subtle.importKey(
            "jwk",
            identity.signingPublicKeyJwk,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"],
          )

          const valid = await subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            importedPublicKey,
            base64UrlToBytes(body.signature),
            new TextEncoder().encode(body.challenge),
          )

          if (!valid) {
            return new Response("Invalid signature", { status: 401 })
          }

          return new Response(
            JSON.stringify({
              token: expectedToken,
              principalId: "principal_device_doc_id",
              expiresAt: Date.now() + 3600_000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not found", { status: 404 })
      }

      // Perform cloud authentication
      const authResult = await manager.authenticateWithCloud(
        "https://mock-cloud.cozea.local",
        mockFetch,
        identity,
      )
      expect(authResult.token).toBe(expectedToken)
      expect(authResult.principalId).toBe("principal_device_doc_id")
    })

    it("fails closed when cloud rejects invalid or revoked identity signature", async () => {
      const manager = new BackgroundDeviceIdentityManager(helper)
      const identity = await manager.generateNewIdentity()

      const mockFetchReject: typeof fetch = async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith("/auth/device/challenge")) {
          return new Response(JSON.stringify({ challenge: "nonce", expiresAt: Date.now() + 120_000 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        if (url.endsWith("/auth/device/token")) {
          // Mock server rejecting revoked device
          return new Response("Device principal revoked or unauthorized", { status: 403 })
        }
        return new Response("Not found", { status: 404 })
      }

      await expect(
        manager.authenticateWithCloud(
          "https://mock-cloud.cozea.local",
          mockFetchReject,
          identity,
        ),
      ).rejects.toThrow(/Device principal revoked or unauthorized/)
    })
  })
})
