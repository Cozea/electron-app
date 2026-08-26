import type { SubstrateRemoteEnvironmentKind } from "../remoteEnvironments";

export const PRIMARY_BACKEND_INSTANCE_ID = "primary" as const;

export interface BackendInstanceDescriptor {
  readonly id: string;
  readonly kind: SubstrateRemoteEnvironmentKind;
  readonly label: string;
  readonly host: string;
  readonly port: number;
  readonly logDirectory: string;
  readonly t3BaseDir: string;
  readonly wslDistro?: string | null;
}

export interface RegisterBackendInstanceInput {
  readonly id: string;
  readonly kind: SubstrateRemoteEnvironmentKind;
  readonly label: string;
  readonly host?: string;
  readonly port: number;
  readonly logDirectory: string;
  readonly t3BaseDir: string;
  readonly wslDistro?: string | null;
}
