import type { DevAppRuntimeLocation, DevAppStateScope } from "./devAppParts";

export const DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION = 1;
export const DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS = 8;
export const DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT = 64;

export type DevAppContainerPlatform = "linux/arm64" | "linux/amd64";

export interface DevAppRuntimeImage {
  /** OCI reference pinned to a manifest-list digest; tags are never launch authority. */
  reference: string;
  manifestDigest: string;
  platformDigest: string;
  platform: DevAppContainerPlatform;
  signature: string;
  attestationDigest: string;
}

export interface DevAppRuntimeIdentity {
  organizationId: string;
  publicationId: string;
  releaseId: string;
  releaseVersion: number;
  contentHash: string;
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

export interface DevAppContainedRuntimeStartRequest {
  runtimeId: string;
  identity: DevAppRuntimeIdentity;
  location: DevAppRuntimeLocation;
  state: DevAppStateScope;
  image: DevAppRuntimeImage;
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

export type DevAppContainerHelperTask = "status" | "start" | "stop" | "delete" | "inspect";

/** Private line-delimited protocol between Electron main and the signed app helper. */
export interface DevAppContainerHelperRequest {
  protocolVersion: number;
  requestId: string;
  task: DevAppContainerHelperTask;
  start?: DevAppContainedRuntimeStartRequest;
  runtimeId?: string;
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
  event: "log" | "state";
  runtimeId: string;
  stream?: "stdout" | "stderr" | "system";
  message?: string;
  state?: DevAppContainedRuntimeState;
}

export function isSha256Digest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export function isDigestPinnedImageReference(value: string): boolean {
  const marker = value.lastIndexOf("@");
  return marker > 0 && isSha256Digest(value.slice(marker + 1));
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
