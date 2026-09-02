import { createHash, generateKeyPairSync, sign } from "node:crypto"

import { describe, expect, it } from "vitest"

import { verifyHostedRuntimeImage } from "../../cloudflare/worker/src/lib/devAppRuntimeImage"
import {
  devAppRuntimeAttestationPayload,
  type DevAppRuntimeIdentity,
  type DevAppRuntimeImageAttestation,
  type DevAppRuntimeReleaseImage,
} from "../../shared/devAppContainedRuntime"

function fixture(): {
  release: DevAppRuntimeReleaseImage
  identity: DevAppRuntimeIdentity
  publicKey: string
} {
  const keys = generateKeyPairSync("ed25519")
  const sourceDigest = "a".repeat(64)
  const packageManifestDigest = `sha256:${"b".repeat(64)}`
  const manifestDigest = `sha256:${"c".repeat(64)}`
  const platforms = [
    { platform: "linux/arm64" as const, digest: `sha256:${"d".repeat(64)}` },
    { platform: "linux/amd64" as const, digest: `sha256:${"e".repeat(64)}` },
  ]
  const attestation: DevAppRuntimeImageAttestation = {
    version: 1,
    builderId: "cozea-devapp-builder/v1",
    sourceDigest,
    packageManifestDigest,
    manifestDigest,
    platforms,
    materials: [],
    builtAt: 1_700_000_000_000,
    reproducible: true,
  }
  const payload = Buffer.from(devAppRuntimeAttestationPayload(attestation), "utf8")
  return {
    release: {
      reference: `ghcr.io/cozea/devapps@${manifestDigest}`,
      manifestDigest,
      platforms,
      signature: sign(null, payload, keys.privateKey).toString("base64"),
      attestationDigest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
      attestation,
    },
    identity: {
      organizationId: "org_1",
      publicationId: "pub_1",
      releaseId: "release_1",
      releaseVersion: 1,
      contentHash: sourceDigest,
      sourceDigest,
      packageManifestDigest,
    },
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

describe("hosted DevApp image verification", () => {
  it("selects only the signed AMD64 platform after verifying the builder key", async () => {
    const input = fixture()
    await expect(verifyHostedRuntimeImage(input.release, input.identity, input.publicKey)).resolves.toMatchObject({
      platform: "linux/amd64",
      platformDigest: `sha256:${"e".repeat(64)}`,
    })
  })

  it("rejects a signature from another builder key", async () => {
    const input = fixture()
    const other = generateKeyPairSync("ed25519")
    const otherPublic = other.publicKey.export({ type: "spki", format: "pem" }).toString()
    await expect(verifyHostedRuntimeImage(input.release, input.identity, otherPublic)).rejects.toThrow(
      "signature could not be verified",
    )
  })
})
