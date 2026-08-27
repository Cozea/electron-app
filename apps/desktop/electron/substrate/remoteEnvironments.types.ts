export type SubstrateRemoteEnvironmentKind = "local" | "ssh" | "wsl";

export interface SubstrateRemoteEnvironmentDescriptor {
  readonly id: string;
  readonly kind: SubstrateRemoteEnvironmentKind;
  readonly label: string;
  readonly ready: boolean;
  readonly endpoint: string | null;
  readonly notes: string;
}
