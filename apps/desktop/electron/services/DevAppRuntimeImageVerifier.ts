import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";

import {
  devAppRuntimeAttestationPayload,
  isDigestPinnedImageReference,
  isSha256Digest,
  type DevAppRuntimeIdentity,
  type DevAppRuntimeImage,
} from "../../../../shared/devAppContainedRuntime";
import type { DevAppRuntimeImageVerifier } from "./ContainedDevAppRuntimeService";

const MAX_ATTESTATION_MATERIALS = 32;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("The DevApp image signature is not canonical base64.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new Error("The DevApp image signature is invalid.");
  }
  return decoded;
}

function isContentHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export class SignedDevAppRuntimeImageVerifier implements DevAppRuntimeImageVerifier {
  private readonly publicKeyPath: () => string;
  private readonly now: () => number;

  constructor(publicKeyPath: () => string, now: () => number = Date.now) {
    this.publicKeyPath = publicKeyPath;
    this.now = now;
  }

  async verify(image: DevAppRuntimeImage, identity: DevAppRuntimeIdentity): Promise<void> {
    if (!isDigestPinnedImageReference(image.reference)) {
      throw new Error("The DevApp image reference is not pinned to an OCI digest.");
    }
    const referenceDigest = image.reference.slice(image.reference.lastIndexOf("@") + 1);
    if (
      referenceDigest !== image.manifestDigest ||
      !isSha256Digest(image.manifestDigest) ||
      !isSha256Digest(image.platformDigest) ||
      !isSha256Digest(image.attestationDigest)
    ) {
      throw new Error("The DevApp image digest authority is inconsistent.");
    }

    const attestation = image.attestation;
    if (
      attestation.version !== 1 ||
      attestation.builderId !== "cozea-devapp-builder/v1" ||
      attestation.reproducible !== true ||
      !isContentHash(attestation.sourceDigest) ||
      attestation.sourceDigest !== identity.sourceDigest ||
      !isSha256Digest(attestation.packageManifestDigest) ||
      attestation.packageManifestDigest !== identity.packageManifestDigest ||
      attestation.manifestDigest !== image.manifestDigest ||
      !Number.isSafeInteger(attestation.builtAt) ||
      attestation.builtAt <= 0 ||
      attestation.builtAt > this.now() + MAX_CLOCK_SKEW_MS
    ) {
      throw new Error("The DevApp image attestation does not match this immutable release.");
    }

    if (
      attestation.materials.length > MAX_ATTESTATION_MATERIALS ||
      attestation.materials.some(
        (material) =>
          !material.uri || material.uri.length > 2048 || !isSha256Digest(material.digest),
      )
    ) {
      throw new Error("The DevApp image build materials are invalid.");
    }

    const platforms = new Map(attestation.platforms.map((entry) => [entry.platform, entry.digest]));
    if (
      platforms.size !== 2 ||
      platforms.get("linux/arm64") === undefined ||
      platforms.get("linux/amd64") === undefined ||
      [...platforms.values()].some((digest) => !isSha256Digest(digest)) ||
      platforms.get(image.platform) !== image.platformDigest
    ) {
      throw new Error("The DevApp image attestation is not a complete multi-platform build.");
    }

    const payload = Buffer.from(devAppRuntimeAttestationPayload(attestation), "utf8");
    const digest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
    if (digest !== image.attestationDigest) {
      throw new Error("The DevApp image attestation digest does not match its statement.");
    }

    const publicKeyFile = this.publicKeyPath();
    if (!fs.existsSync(publicKeyFile)) {
      throw new Error("The trusted DevApp builder public key is unavailable.");
    }
    const publicKey = createPublicKey(fs.readFileSync(publicKeyFile, "utf8"));
    if (!verify(null, payload, publicKey, decodeCanonicalBase64(image.signature))) {
      throw new Error("The DevApp image signature could not be verified.");
    }
  }
}
