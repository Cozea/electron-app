/**
 * Remote environment catalog backed by DesktopBackendPool + SSH discovery.
 */
import type { SubstrateRemoteEnvironmentDescriptor } from "./remoteEnvironments.types";
import { getDesktopBackendPool } from "./backend/DesktopBackendPool";
import { PRIMARY_BACKEND_INSTANCE_ID } from "./backend/types";
import { detectSshConfigPresent, discoverSshHostsFromConfig } from "./ssh/parseSshConfig";
import { detectWslAvailable, readWslBackendSettings } from "./wsl/wslSettings";
import { resolveWslInstanceId } from "./wsl/wslBackend";

export type { SubstrateRemoteEnvironmentKind, SubstrateRemoteEnvironmentDescriptor } from "./remoteEnvironments.types";

export function listSubstrateRemoteEnvironments(input?: {
  readonly wslSettingsPath?: string;
}): ReadonlyArray<SubstrateRemoteEnvironmentDescriptor> {
  const pool = getDesktopBackendPool();
  const descriptors = pool?.listDescriptors() ?? [];
  const primary = descriptors.find((entry) => entry.id === PRIMARY_BACKEND_INSTANCE_ID);
  const primaryManager = pool?.getManager(PRIMARY_BACKEND_INSTANCE_ID);
  const primaryReady = primaryManager?.getStatus().phase === "ready";

  const environments: SubstrateRemoteEnvironmentDescriptor[] = [
    {
      id: PRIMARY_BACKEND_INSTANCE_ID,
      kind: "local",
      label: process.platform === "darwin" ? "This Mac / local" : "Local machine",
      ready: primaryReady,
      endpoint: primary ? `http://${primary.host}:${primary.port}` : null,
      notes: "Primary substrate shadow server on loopback.",
    },
  ];

  const wslSettings =
    input?.wslSettingsPath !== undefined
      ? readWslBackendSettings(input.wslSettingsPath)
      : { enabled: false, distro: null };
  const wslInstanceId = resolveWslInstanceId(wslSettings.distro);
  const wslManager = pool?.getManager(wslInstanceId);
  const wslDescriptor = descriptors.find((entry) => entry.id === wslInstanceId);
  const wslReady = wslManager?.getStatus().phase === "ready";

  environments.push({
    id: wslInstanceId,
    kind: "wsl",
    label: wslDescriptor?.label ?? (detectWslAvailable() ? "WSL backend" : "WSL backend (unavailable)"),
    ready: wslSettings.enabled && wslReady,
    endpoint:
      wslDescriptor && wslReady ? `http://${wslDescriptor.host}:${wslDescriptor.port}` : null,
    notes: wslSettings.enabled
      ? wslReady
        ? "Secondary WSL backend registered in DesktopBackendPool."
        : "WSL backend enabled; waiting for readiness."
      : detectWslAvailable()
        ? "Enable WSL backend in Connections to register a secondary instance."
        : "WSL not detected on this host.",
  });

  const sshHosts = discoverSshHostsFromConfig();
  if (sshHosts.length === 0) {
    environments.push({
      id: "ssh-catalog",
      kind: "ssh",
      label: detectSshConfigPresent() ? "SSH remote (no hosts parsed)" : "SSH remote (configure ~/.ssh)",
      ready: false,
      endpoint: null,
      notes: detectSshConfigPresent()
        ? "SSH config present; add Host entries or use discoverSshHosts IPC."
        : "Add SSH host entries to enable remote substrate environments.",
    });
  } else {
    for (const host of sshHosts) {
      environments.push({
        id: `ssh:${host.alias}`,
        kind: "ssh",
        label: `SSH: ${host.alias}`,
        ready: false,
        endpoint: null,
        notes: `Discovered from ~/.ssh/config (${host.hostname}). Call ensureSshEnvironment to connect.`,
      });
    }
  }

  return environments;
}

/** @deprecated Use listSubstrateRemoteEnvironments */
export function listSubstrateRemoteEnvironmentStubs(): ReadonlyArray<SubstrateRemoteEnvironmentDescriptor> {
  return listSubstrateRemoteEnvironments();
}
