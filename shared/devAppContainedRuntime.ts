import type { DevAppRuntimeLocation, DevAppStateScope } from "./devAppParts";

export const DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION = 1;
export const DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS = 8;
export const DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT = 64;
export const DEV_APP_RUNTIME_BUILD_SOURCE_MAX_BYTES = 128 * 1024 * 1024;

export type DevAppContainerPlatform = "linux/arm64" | "linux/amd64";

export interface DevAppRuntimePlatformImage {
  platform: DevAppContainerPlatform;
  digest: string;
}

export interface DevAppRuntimeBuildMaterial {
  uri: string;
  digest: string;
}

/** Reproducible-build statement signed by Cozea's central DevApp builder. */
export interface DevAppRuntimeImageAttestation {
  version: 1;
  builderId: "cozea-devapp-builder/v1";
  sourceDigest: string;
  packageManifestDigest: string;
  manifestDigest: string;
  platforms: DevAppRuntimePlatformImage[];
  materials: DevAppRuntimeBuildMaterial[];
  builtAt: number;
  reproducible: true;
}

export interface DevAppRuntimeImage {
  /** OCI reference pinned to a manifest-list digest; tags are never launch authority. */
  reference: string;
  manifestDigest: string;
  platformDigest: string;
  platform: DevAppContainerPlatform;
  signature: string;
  attestationDigest: string;
  attestation: DevAppRuntimeImageAttestation;
}

/** Immutable multi-platform image authority stored on an organization release. */
export interface DevAppRuntimeReleaseImage {
  reference: string;
  manifestDigest: string;
  platforms: DevAppRuntimePlatformImage[];
  signature: string;
  attestationDigest: string;
  attestation: DevAppRuntimeImageAttestation;
}

export type DevAppRuntimeBuildStatus = "queued" | "building" | "ready" | "failed";

/** Public status returned by the authenticated central-builder gateway. */
export interface DevAppRuntimeBuildDescriptor {
  buildId: string;
  projectId: string;
  uploadReservationId: string;
  sourceDigest: string;
  packageManifestDigest: string;
  status: DevAppRuntimeBuildStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface DevAppRuntimeIdentity {
  organizationId: string;
  publicationId: string;
  releaseId: string;
  releaseVersion: number;
  contentHash: string;
  sourceDigest: string;
  packageManifestDigest: string;
}

export interface DevAppRuntimeResources {
  cpus: number;
  memoryBytes: number;
  rootfsBytes: number;
  writableLayerBytes: number;
}

export type DevAppFolderGrantAccess = "read" | "readWrite";

/** An already-approved, release-bound native-semantics folder mount. */
export interface DevAppFolderGrant {
  grantId: string;
  publicationId: string;
  releaseId: string;
  canonicalHostPath: string;
  guestPath: string;
  access: DevAppFolderGrantAccess;
  expiresAt: number;
}

/** Short-lived pull-only authority. It is consumed in memory by the native helper. */
export interface DevAppRuntimeRegistryAuth {
  scheme: "bearer";
  token: string;
  expiresAt: number;
}

export interface DevAppContainedRuntimeStartRequest {
  runtimeId: string;
  identity: DevAppRuntimeIdentity;
  location: DevAppRuntimeLocation;
  state: DevAppStateScope;
  image: DevAppRuntimeImage;
  registryAuth: DevAppRuntimeRegistryAuth;
  command: string[];
  environment: Record<string, string>;
  workingDirectory: string;
  servicePort?: number;
  network: boolean;
  resources: DevAppRuntimeResources;
  folderGrants: DevAppFolderGrant[];
}

export type DevAppContainedRuntimeStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface DevAppContainedRuntimeState {
  runtimeId: string;
  status: DevAppContainedRuntimeStatus;
  location: DevAppRuntimeLocation;
  state: DevAppStateScope;
  publicationId: string;
  releaseId: string;
  imageDigest: string;
  guestAddress: string | null;
  servicePort: number | null;
  startedAt: number | null;
  exitedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface DevAppContainedRuntimeAvailability {
  available: boolean;
  adapter: "apple-containerization" | "hosted" | "unavailable";
  protocolVersion: number;
  reason: string | null;
}

export type DevAppContainerHelperTask =
  | "status"
  | "start"
  | "stop"
  | "delete"
  | "inspect"
  | "message";

export interface DevAppContainedRuntimeTransportEnvelope {
  channel: "host" | "view";
  connectionId?: string;
  message?: unknown;
  close?: boolean;
}

/** Private line-delimited protocol between Electron main and the signed app helper. */
export interface DevAppContainerHelperRequest {
  protocolVersion: number;
  requestId: string;
  task: DevAppContainerHelperTask;
  start?: DevAppContainedRuntimeStartRequest;
  runtimeId?: string;
  transport?: DevAppContainedRuntimeTransportEnvelope;
}

export interface DevAppContainerHelperResponse {
  protocolVersion: number;
  requestId: string;
  success: boolean;
  availability?: DevAppContainedRuntimeAvailability;
  state?: DevAppContainedRuntimeState;
  error?: string;
}

export interface DevAppContainerHelperEvent {
  protocolVersion: number;
  event: "log" | "state" | "message";
  runtimeId: string;
  stream?: "stdout" | "stderr" | "system";
  message?: string;
  state?: DevAppContainedRuntimeState;
  transport?: DevAppContainedRuntimeTransportEnvelope;
}

export function isSha256Digest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export function isDigestPinnedImageReference(value: string): boolean {
  const marker = value.lastIndexOf("@");
  return marker > 0 && isSha256Digest(value.slice(marker + 1));
}

export function canonicalDevAppRuntimeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalDevAppRuntimeJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalDevAppRuntimeJson(record[key])}`)
    .join(",")}}`;
}

export function devAppRuntimeAttestationPayload(
  attestation: DevAppRuntimeImageAttestation,
): string {
  return `cozea-devapp-image-attestation-v1\n${canonicalDevAppRuntimeJson(attestation)}`;
}

export function selectDevAppRuntimeImage(
  release: DevAppRuntimeReleaseImage,
  platform: DevAppContainerPlatform,
): DevAppRuntimeImage {
  const selected = release.platforms.find((entry) => entry.platform === platform);
  if (!selected) throw new Error(`The DevApp image has no ${platform} build.`);
  return {
    reference: release.reference,
    manifestDigest: release.manifestDigest,
    platformDigest: selected.digest,
    platform,
    signature: release.signature,
    attestationDigest: release.attestationDigest,
    attestation: release.attestation,
  };
}

export function validateDevAppRuntimeReleaseImage(
  release: DevAppRuntimeReleaseImage,
  expected: { sourceDigest: string; packageManifestDigest: string },
): string | null {
  if (
    !release ||
    typeof release !== "object" ||
    typeof release.reference !== "string" ||
    !isDigestPinnedImageReference(release.reference)
  ) {
    return "The DevApp runtime image reference is invalid.";
  }
  const referenceDigest = release.reference.slice(release.reference.lastIndexOf("@") + 1);
  if (
    release.manifestDigest !== referenceDigest ||
    !isSha256Digest(release.manifestDigest) ||
    !isSha256Digest(release.attestationDigest) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(release.signature) ||
    release.signature.length > 16_384
  ) {
    return "The DevApp runtime image authority is invalid.";
  }
  if (
    !Array.isArray(release.platforms) ||
    release.platforms.some((entry) =>
      !entry ||
      typeof entry !== "object" ||
      (entry.platform !== "linux/arm64" && entry.platform !== "linux/amd64") ||
      typeof entry.digest !== "string",
    )
  ) return "The DevApp runtime image platforms are invalid.";
  const platforms = new Map(release.platforms.map((entry) => [entry.platform, entry.digest]));
  if (
    release.platforms.length !== 2 ||
    platforms.size !== 2 ||
    !isSha256Digest(platforms.get("linux/arm64") ?? "") ||
    !isSha256Digest(platforms.get("linux/amd64") ?? "")
  ) {
    return "The DevApp runtime image must contain exactly arm64 and amd64 Linux images.";
  }
  const attestation = release.attestation;
  if (
    !attestation ||
    attestation.version !== 1 ||
    attestation.builderId !== "cozea-devapp-builder/v1" ||
    attestation.reproducible !== true ||
    attestation.sourceDigest !== expected.sourceDigest ||
    attestation.packageManifestDigest !== expected.packageManifestDigest ||
    attestation.manifestDigest !== release.manifestDigest ||
    !Number.isSafeInteger(attestation.builtAt) ||
    attestation.builtAt <= 0 ||
    !Array.isArray(attestation.platforms) ||
    !Array.isArray(attestation.materials) ||
    attestation.materials.length > 32 ||
    attestation.materials.some(
      (material) =>
        !material ||
        typeof material !== "object" ||
        typeof material.uri !== "string" ||
        !material.uri ||
        material.uri.length > 2048 ||
        typeof material.digest !== "string" ||
        !isSha256Digest(material.digest),
    )
  ) {
    return "The DevApp runtime image attestation is invalid.";
  }
  if (
    JSON.stringify(attestation.platforms) !== JSON.stringify(release.platforms)
  ) {
    return "The DevApp runtime image platform statement is inconsistent.";
  }
  return null;
}

export function validateRuntimePlacement(
  location: DevAppRuntimeLocation,
  state: DevAppStateScope,
): string | null {
  if (location === "device" && state === "organization") {
    return "A device runtime cannot own organization state.";
  }
  if (location === "hosted" && state === "device") {
    return "A hosted runtime cannot own device state.";
  }
  return null;
}
