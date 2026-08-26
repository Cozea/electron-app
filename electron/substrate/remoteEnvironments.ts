/**
 * Phase 6 — remote / SSH environment catalog stubs.
 * Real SSH/WSL pooling lands after local Phase 1–2 path is solid.
 */

export type SubstrateRemoteEnvironmentKind = "local" | "ssh" | "wsl";

export interface SubstrateRemoteEnvironmentDescriptor {
  readonly id: string;
  readonly kind: SubstrateRemoteEnvironmentKind;
  readonly label: string;
  readonly ready: boolean;
  readonly endpoint: string | null;
  readonly notes: string;
}

export function listSubstrateRemoteEnvironmentStubs(): ReadonlyArray<SubstrateRemoteEnvironmentDescriptor> {
  return [
    {
      id: "local-primary",
      kind: "local",
      label: "This Mac / local",
      ready: true,
      endpoint: "http://127.0.0.1:4783",
      notes: "Phase 1 shadow server on loopback.",
    },
    {
      id: "ssh-placeholder",
      kind: "ssh",
      label: "SSH remote (not enabled)",
      ready: false,
      endpoint: null,
      notes: "Phase 6 — enabled after local substrate is primary.",
    },
    {
      id: "wsl-placeholder",
      kind: "wsl",
      label: "WSL backend (not enabled)",
      ready: false,
      endpoint: null,
      notes: "Mirrors T3 DesktopBackendPool secondary instance — deferred.",
    },
  ];
}
