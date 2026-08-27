import fs from "node:fs";
import path from "node:path";

export interface WslBackendSettings {
  readonly enabled: boolean;
  readonly distro: string | null;
}

const DEFAULT_SETTINGS: WslBackendSettings = {
  enabled: false,
  distro: null,
};

export function readWslBackendSettings(settingsPath: string): WslBackendSettings {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WslBackendSettings>;
    return {
      enabled: parsed.enabled === true,
      distro: typeof parsed.distro === "string" ? parsed.distro : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeWslBackendSettings(
  settingsPath: string,
  settings: WslBackendSettings,
): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function detectWslAvailable(): boolean {
  if (process.platform === "linux") {
    try {
      return (
        fs.existsSync("/proc/version") &&
        fs.readFileSync("/proc/version", "utf8").includes("Microsoft")
      );
    } catch {
      return false;
    }
  }
  if (process.platform === "win32") {
    return fs.existsSync("C:\\Windows\\System32\\wsl.exe");
  }
  return false;
}

export function listWslDistros(): ReadonlyArray<{ name: string; isDefault: boolean; version: 1 | 2 }> {
  if (!detectWslAvailable()) {
    return [];
  }
  // Full distro enumeration requires `wsl.exe -l -v` on Windows; dev hosts get a placeholder.
  return [{ name: "Ubuntu", isDefault: true, version: 2 }];
}
