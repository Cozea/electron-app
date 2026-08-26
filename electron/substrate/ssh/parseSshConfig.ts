import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DesktopDiscoveredSshHost } from "@cozea/contracts";

function readSshConfigLines(configPath: string): ReadonlyArray<string> {
  try {
    return fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function parseHostBlock(
  lines: ReadonlyArray<string>,
  startIndex: number,
): {
  readonly alias: string;
  readonly endIndex: number;
  hostname: string | null;
  username: string | null;
  port: number | null;
} {
  const aliasLine = lines[startIndex]?.trim() ?? "";
  const alias = aliasLine.replace(/^Host\s+/i, "").trim();
  let hostname: string | null = null;
  let username: string | null = null;
  let port: number | null = null;
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0 || line.startsWith("#")) {
      index += 1;
      continue;
    }
    if (/^Host\s+/i.test(line)) {
      break;
    }
    const [key, ...rest] = line.split(/\s+/);
    const value = rest.join(" ").trim();
    switch (key?.toLowerCase()) {
      case "hostname":
        hostname = value || null;
        break;
      case "user":
        username = value || null;
        break;
      case "port": {
        const parsed = Number.parseInt(value, 10);
        port = Number.isFinite(parsed) ? parsed : null;
        break;
      }
      default:
        break;
    }
    index += 1;
  }
  return { alias, endIndex: index, hostname, username, port };
}

export function discoverSshHostsFromConfig(
  configPath = path.join(os.homedir(), ".ssh", "config"),
): ReadonlyArray<DesktopDiscoveredSshHost> {
  const lines = readSshConfigLines(configPath);
  const hosts: DesktopDiscoveredSshHost[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!/^Host\s+/i.test(line)) {
      continue;
    }
    const alias = line.replace(/^Host\s+/i, "").trim();
    if (alias === "*" || alias.includes("*") || alias.includes("?")) {
      continue;
    }
    const block = parseHostBlock(lines, index);
    index = block.endIndex - 1;
    hosts.push({
      alias: block.alias,
      hostname: block.hostname ?? block.alias,
      username: block.username,
      port: block.port,
      source: "ssh-config",
    });
  }
  return hosts;
}

export function detectSshConfigPresent(): boolean {
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
