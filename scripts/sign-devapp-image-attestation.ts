import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  devAppRuntimeAttestationPayload,
  isDigestPinnedImageReference,
  isSha256Digest,
  type DevAppRuntimeImageAttestation,
  type DevAppRuntimeReleaseImage,
} from "../shared/devAppContainedRuntime";

interface UnsignedBuildResult {
  reference: string;
  manifestDigest: string;
  sourceDigest: string;
  packageManifestDigest: string;
  platforms: DevAppRuntimeImageAttestation["platforms"];
  materials: DevAppRuntimeImageAttestation["materials"];
  builtAt: number;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}.`);
  return path.resolve(value);
}

function signingKey(): string {
  const inline = process.env.COZEA_RUNTIME_SIGNING_PRIVATE_KEY?.trim();
  const filePath = process.env.COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH?.trim();
  if (filePath) return fs.readFileSync(path.resolve(filePath), "utf8");
  if (inline?.includes("BEGIN PRIVATE KEY")) return inline;
  if (inline) {
    const decoded = Buffer.from(inline, "base64").toString("utf8");
    if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;
  }
  throw new Error("The trusted DevApp builder signing key is unavailable.");
}

function parseBuildResult(filePath: string): UnsignedBuildResult {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The unsigned DevApp build result is invalid.");
  }
  const input = value as Partial<UnsignedBuildResult>;
  const referenceDigest = input.reference?.slice(input.reference.lastIndexOf("@") + 1);
  if (
    !input.reference ||
    !isDigestPinnedImageReference(input.reference) ||
    !input.manifestDigest ||
    input.manifestDigest !== referenceDigest ||
    !/^[a-f0-9]{64}$/.test(input.sourceDigest ?? "") ||
    !isSha256Digest(input.packageManifestDigest ?? "") ||
    !Array.isArray(input.platforms) ||
    input.platforms.length !== 2 ||
    !Array.isArray(input.materials) ||
    input.materials.length > 32 ||
    !Number.isSafeInteger(input.builtAt) ||
    (input.builtAt ?? 0) <= 0
  ) {
    throw new Error("The unsigned DevApp build result is incomplete.");
  }
  const platforms = new Map(input.platforms.map((entry) => [entry.platform, entry.digest]));
  if (
    platforms.size !== 2 ||
    !isSha256Digest(platforms.get("linux/arm64") ?? "") ||
    !isSha256Digest(platforms.get("linux/amd64") ?? "") ||
    input.materials.some(
      (material) =>
        !material.uri || material.uri.length > 2048 || !isSha256Digest(material.digest),
    )
  ) {
    throw new Error("The unsigned DevApp build result is not a valid multi-platform build.");
  }
  return input as UnsignedBuildResult;
}

function main(): void {
  const inputPath = argument("--input");
  const outputPath = argument("--output");
  const publicKeyOutput = argument("--public-key-output");
  const build = parseBuildResult(inputPath);
  const attestation: DevAppRuntimeImageAttestation = {
    version: 1,
    builderId: "cozea-devapp-builder/v1",
    sourceDigest: build.sourceDigest,
    packageManifestDigest: build.packageManifestDigest,
    manifestDigest: build.manifestDigest,
    platforms: build.platforms,
    materials: build.materials,
    builtAt: build.builtAt,
    reproducible: true,
  };
  const payload = Buffer.from(devAppRuntimeAttestationPayload(attestation), "utf8");
  const privateKey = createPrivateKey(signingKey());
  const releaseImage: DevAppRuntimeReleaseImage = {
    reference: build.reference,
    manifestDigest: build.manifestDigest,
    platforms: build.platforms,
    signature: sign(null, payload, privateKey).toString("base64"),
    attestationDigest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
    attestation,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(releaseImage, null, 2)}\n`, { mode: 0o600 });
  fs.mkdirSync(path.dirname(publicKeyOutput), { recursive: true });
  fs.writeFileSync(
    publicKeyOutput,
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
}

try {
  main();
} catch (error) {
  console.error(
    `[devapp-image-sign] ERROR: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
