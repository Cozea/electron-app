/**
 * Phase 6 — remote environment catalog.
 * Local is always ready; SSH/WSL entries reflect host capability probes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SubstrateRemoteEnvironmentKind = "local" | "ssh" | "wsl";

export interface SubstrateRemoteEnvironmentDescriptor {
  readonly id: string;
  readonly kind: SubstrateRemoteEnvironmentKind;
  readonly label: string;
  readonly ready: boolean;
  readonly endpoint: string | null;
  readonly notes: string;
}

function detectSshConfigPresent(): boolean {
  const home = os.homedir();
  const candidates = [path.join(home, ".ssh", "config"), path.join(home, ".ssh", "known_hosts")];
  return candidates.some((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

function detectWslAvailable(): boolean {
  if (process.platform === "linux") {
    return fs.existsSync("/proc/version") && fs.readFileSync("/proc/version", "utf8").includes("Microsoft");
  }
  if (process.platform === "win32") {
    return fs.existsSync("C:\\Windows\\System32\\wsl.exe");
  }
  return false;
}

export function listSubstrateRemoteEnvironmentStubs(): ReadonlyArray<SubstrateRemoteEnvironmentDescriptor> {
  const shadowPort = process.env.COZEA_SUBSTRATE_SHADOW_PORT?.trim() || "4783";
  const localEndpoint = `http://127.0.0.1:${shadowPort}`;
  const sshDetected = detectSshConfigPresent();
  const wslDetected = detectWslAvailable();

  return [
    {
      id: "local-primary",
      kind: "local",
      label: process.platform === "darwin" ? "This Mac / local" : "Local machine",
      ready: true,
      endpoint: localEndpoint,
      notes: "Primary substrate shadow server on loopback.",
    },
    {
      id: "ssh-catalog",
      kind: "ssh",
      label: sshDetected ? "SSH remote (catalog ready)" : "SSH remote (configure ~/.ssh)",
      ready: false,
      endpoint: null,
      notes: sshDetected
        ? "SSH config detected. Backend pool wiring lands in Phase 6 — local path is primary today."
        : "Add SSH host entries to enable future remote substrate backends.",
    },
    {
      id: "wsl-catalog",
      kind: "wsl",
      label: wslDetected ? "WSL backend (detected)" : "WSL backend (not detected)",
      ready: false,
      endpoint: null,
      notes: wslDetected
        ? "WSL is available on this host. Secondary DesktopBackendPool instance is deferred."
        : "WSL not detected on this host.",
    },
  ];
}
