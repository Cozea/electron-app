import { ipcMain } from "electron";

import type {
  DesktopDiscoveredSshHost,
  DesktopEnvironmentBootstrap,
  DesktopSshEnvironmentTarget,
  DesktopWslState,
} from "@cozea/contracts";

import { listLocalEnvironmentBootstraps } from "../substrate/backend/localEnvironmentBootstraps";
import { getDesktopBackendPool } from "../substrate/backend/DesktopBackendPool";
import { discoverSshHostsFromConfig } from "../substrate/ssh/parseSshConfig";
import {
  readWslBackendState,
  reconcileWslBackend,
  setWslBackendEnabled,
  setWslDistro,
} from "../substrate/wsl/wslBackend";

export interface SubstrateRemoteIpcContext {
  readonly wslSettingsPath: string;
}

export function registerSubstrateRemoteHandlers(context: SubstrateRemoteIpcContext): void {
  ipcMain.handle("substrate:getLocalEnvironmentBootstraps", (): readonly DesktopEnvironmentBootstrap[] => {
    const pool = getDesktopBackendPool();
    if (!pool) {
      return [];
    }
    return listLocalEnvironmentBootstraps(pool);
  });

  ipcMain.handle("substrate:discoverSshHosts", (): readonly DesktopDiscoveredSshHost[] => {
    return discoverSshHostsFromConfig();
  });

  ipcMain.handle(
    "substrate:ensureSshEnvironment",
    async (_event, _target: DesktopSshEnvironmentTarget) => {
      throw new Error(
        "Managed SSH substrate environments require @t3tools/ssh tunnel wiring (coming soon). Use local/WSL backends today.",
      );
    },
  );

  ipcMain.handle("substrate:getWslState", async (): Promise<DesktopWslState> => {
    return readWslBackendState(context.wslSettingsPath);
  });

  ipcMain.handle("substrate:setWslBackendEnabled", async (_event, enabled: boolean) => {
    const pool = getDesktopBackendPool();
    if (!pool) {
      throw new Error("DesktopBackendPool is not initialized.");
    }
    return setWslBackendEnabled({
      pool,
      settingsPath: context.wslSettingsPath,
      enabled: enabled === true,
    });
  });

  ipcMain.handle("substrate:setWslDistro", async (_event, distro: string | null) => {
    const pool = getDesktopBackendPool();
    if (!pool) {
      throw new Error("DesktopBackendPool is not initialized.");
    }
    return setWslDistro({
      pool,
      settingsPath: context.wslSettingsPath,
      distro: typeof distro === "string" ? distro : null,
    });
  });

  ipcMain.handle("substrate:reconcileWslBackend", async () => {
    const pool = getDesktopBackendPool();
    if (!pool) {
      throw new Error("DesktopBackendPool is not initialized.");
    }
    await reconcileWslBackend({ pool, settingsPath: context.wslSettingsPath });
    return readWslBackendState(context.wslSettingsPath);
  });
}
