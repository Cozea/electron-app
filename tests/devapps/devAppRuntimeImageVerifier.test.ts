import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SignedDevAppRuntimeImageVerifier } from "../../apps/desktop/electron/services/DevAppRuntimeImageVerifier";
import {
  devAppRuntimeAttestationPayload,
  type DevAppRuntimeIdentity,
  type DevAppRuntimeImage,
  type DevAppRuntimeImageAttestation,
} from "../../shared/devAppContainedRuntime";

const sourceDigest = "a".repeat(64);
const manifestDigest = `sha256:${"b".repeat(64)}`;
const armDigest = `sha256:${"c".repeat(64)}`;
const amdDigest = `sha256:${"d".repeat(64)}`;
const packageManifestDigest = `sha256:${"e".repeat(64)}`;
const temporaryRoots: string[] = [];

function fixture(): {
  image: DevAppRuntimeImage;
  identity: DevAppRuntimeIdentity;
  publicKeyPath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-image-verifier-"));
  temporaryRoots.push(root);
  const keys = generateKeyPairSync("ed25519");
  const publicKeyPath = path.join(root, "builder-public-key.pem");
  fs.writeFileSync(
    publicKeyPath,
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  const attestation: DevAppRuntimeImageAttestation = {
    version: 1,
    builderId: "cozea-devapp-builder/v1",
    sourceDigest,
    packageManifestDigest,
    manifestDigest,
    platforms: [
      { platform: "linux/arm64", digest: armDigest },
      { platform: "linux/amd64", digest: amdDigest },
    ],
    materials: [{ uri: "git+https://github.com/Cozea/devapp-builder", digest: manifestDigest }],
    builtAt: 1_700_000_000_000,
    reproducible: true,
  };
  const payload = Buffer.from(devAppRuntimeAttestationPayload(attestation), "utf8");
  return {
    image: {
      reference: `ghcr.io/cozea/devapps/example@${manifestDigest}`,
      manifestDigest,
      platformDigest: armDigest,
      platform: "linux/arm64",
      signature: sign(null, payload, keys.privateKey).toString("base64"),
      attestationDigest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
      attestation,
    },
    identity: {
      organizationId: "organization-a",
      publicationId: "publication-a",
      releaseId: "release-a",
      releaseVersion: 1,
      contentHash: sourceDigest,
      sourceDigest,
      packageManifestDigest,
    },
    publicKeyPath,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SignedDevAppRuntimeImageVerifier", () => {
  it("accepts a signed reproducible multi-platform build bound to the source", async () => {
    const input = fixture();
    const verifier = new SignedDevAppRuntimeImageVerifier(
      () => input.publicKeyPath,
      () => 1_700_000_100_000,
    );

    await expect(verifier.verify(input.image, input.identity)).resolves.toBeUndefined();
  });

  it("rejects a release whose source is not the attested source", async () => {
    const input = fixture();
    input.identity.sourceDigest = "e".repeat(64);
    const verifier = new SignedDevAppRuntimeImageVerifier(
      () => input.publicKeyPath,
      () => 1_700_000_100_000,
    );

    await expect(verifier.verify(input.image, input.identity)).rejects.toThrow(
      "does not match this immutable release",
    );
  });

  it("rejects tampered attestations even when their declared digest is changed", async () => {
    const input = fixture();
    input.image.attestation.materials = [];
    const payload = Buffer.from(devAppRuntimeAttestationPayload(input.image.attestation), "utf8");
    input.image.attestationDigest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
    const verifier = new SignedDevAppRuntimeImageVerifier(
      () => input.publicKeyPath,
      () => 1_700_000_100_000,
    );

    await expect(verifier.verify(input.image, input.identity)).rejects.toThrow(
      "signature could not be verified",
    );
  });

  it("rejects an image missing either supported Linux platform", async () => {
    const input = fixture();
    input.image.attestation.platforms = [{ platform: "linux/arm64", digest: armDigest }];
    const verifier = new SignedDevAppRuntimeImageVerifier(
      () => input.publicKeyPath,
      () => 1_700_000_100_000,
    );

    await expect(verifier.verify(input.image, input.identity)).rejects.toThrow(
      "not a complete multi-platform build",
    );
  });
});
