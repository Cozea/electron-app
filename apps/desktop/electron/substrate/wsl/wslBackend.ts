import type { DesktopBackendPool } from "../backend/DesktopBackendPool";
import { PRIMARY_BACKEND_INSTANCE_ID } from "../backend/types";
import { readSubstrateShadowServerFlags } from "../flags";
import {
  detectWslAvailable,
  listWslDistros,
  readWslBackendSettings,
  writeWslBackendSettings,
  type WslBackendSettings,
} from "./wslSettings";

const WSL_INSTANCE_PREFIX = "wsl:";

export function resolveWslInstanceId(distro: string | null): string {
  return distro ? `${WSL_INSTANCE_PREFIX}${distro}` : `${WSL_INSTANCE_PREFIX}default`;
}

export function readWslBackendState(settingsPath: string) {
  const settings = readWslBackendSettings(settingsPath);
  return {
    enabled: settings.enabled,
    distro: settings.distro,
    available: detectWslAvailable(),
    wslOnly: false,
    distros: listWslDistros(),
    preflightError: null,
  };
}

export async function reconcileWslBackend(input: {
  readonly pool: DesktopBackendPool;
  readonly settingsPath: string;
  readonly forceDevSecondary?: boolean;
}): Promise<WslBackendSettings> {
  const settings = readWslBackendSettings(input.settingsPath);
  const instanceId = resolveWslInstanceId(settings.distro);
  const existing = input.pool.getManager(instanceId);

  if (!settings.enabled) {
    if (existing) {
      await input.pool.unregister(instanceId);
    }
    return settings;
  }

  if (existing?.getStatus().phase === "ready") {
    return settings;
  }

  const flags = readSubstrateShadowServerFlags();
  const primary = input.pool.getManager(PRIMARY_BACKEND_INSTANCE_ID);
  const primaryPort = primary?.getStatus().port ?? flags.port;
  const secondaryPort = primaryPort + 1;
  const distroLabel = settings.distro ?? "default";

  await input.pool.register({
    id: instanceId,
    kind: "wsl",
    label: detectWslAvailable()
      ? `WSL (${distroLabel})`
      : `WSL backend (${distroLabel}, loopback dev)`,
    port: secondaryPort,
    logDirectory: input.pool.resolveInstanceLogDirectory(instanceId),
    t3BaseDir: input.pool.resolveInstanceT3BaseDir(instanceId),
    wslDistro: settings.distro,
  });

  return settings;
}

export async function setWslBackendEnabled(input: {
  readonly pool: DesktopBackendPool;
  readonly settingsPath: string;
  readonly enabled: boolean;
}): Promise<ReturnType<typeof readWslBackendState>> {
  const current = readWslBackendSettings(input.settingsPath);
  const next = { ...current, enabled: input.enabled };
  writeWslBackendSettings(input.settingsPath, next);
  await reconcileWslBackend({ pool: input.pool, settingsPath: input.settingsPath });
  return readWslBackendState(input.settingsPath);
}

export async function setWslDistro(input: {
  readonly pool: DesktopBackendPool;
  readonly settingsPath: string;
  readonly distro: string | null;
}): Promise<ReturnType<typeof readWslBackendState>> {
  const current = readWslBackendSettings(input.settingsPath);
  const previousId = resolveWslInstanceId(current.distro);
  if (input.pool.getManager(previousId)) {
    await input.pool.unregister(previousId);
  }
  const next = { ...current, distro: input.distro };
  writeWslBackendSettings(input.settingsPath, next);
  if (next.enabled) {
    await reconcileWslBackend({ pool: input.pool, settingsPath: input.settingsPath });
  }
  return readWslBackendState(input.settingsPath);
}
