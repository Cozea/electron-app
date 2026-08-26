import { ipcMain } from "electron";

import { isSubstrateVcsEnabled } from "../flags";
import { invalidateVcsStatus } from "./statusInvalidation";

const SUBSTRATE_VCS_INVALIDATE_HANDLE = "substrate:vcs:invalidate" as const;
const SUBSTRATE_VCS_CAPABILITIES_HANDLE = "substrate:vcs:capabilities" as const;

export interface SubstrateVcsCapabilitiesResponse {
  readonly enabled: boolean;
  readonly capabilities: {
    readonly status: boolean;
    readonly refs: boolean;
    readonly worktrees: boolean;
    readonly checkpoints: boolean;
    readonly push: boolean;
    readonly ignore: boolean;
    readonly init: boolean;
  };
}

let registered = false;

/**
 * Phase 4a cutover surface — substrate VCS IPC behind `COZEA_SUBSTRATE_VCS=1`.
 * Legacy `git:*` channels remain until agent paths migrate; these handlers give
 * the renderer a flagged entry point for invalidate + capability discovery.
 */
export function registerSubstrateVcsIpcHandlers(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.removeHandler(SUBSTRATE_VCS_INVALIDATE_HANDLE);
  ipcMain.handle(SUBSTRATE_VCS_INVALIDATE_HANDLE, (_event, cwd: unknown) => {
    if (!isSubstrateVcsEnabled(env)) {
      return { ok: false, reason: "substrate_vcs_disabled" as const };
    }
    if (typeof cwd !== "string" || cwd.trim().length === 0) {
      return { ok: false, reason: "invalid_cwd" as const };
    }
    invalidateVcsStatus(cwd.trim());
    return { ok: true as const };
  });

  ipcMain.removeHandler(SUBSTRATE_VCS_CAPABILITIES_HANDLE);
  ipcMain.handle(SUBSTRATE_VCS_CAPABILITIES_HANDLE, (): SubstrateVcsCapabilitiesResponse => {
    const enabled = isSubstrateVcsEnabled(env);
    return {
      enabled,
      capabilities: {
        status: enabled,
        refs: false,
        worktrees: enabled,
        checkpoints: enabled,
        push: enabled,
        ignore: false,
        init: false,
      },
    };
  });
}

/** @internal test helper */
export function resetSubstrateVcsIpcHandlersForTests(): void {
  ipcMain.removeHandler(SUBSTRATE_VCS_INVALIDATE_HANDLE);
  ipcMain.removeHandler(SUBSTRATE_VCS_CAPABILITIES_HANDLE);
  registered = false;
}

export {
  SUBSTRATE_VCS_CAPABILITIES_HANDLE,
  SUBSTRATE_VCS_INVALIDATE_HANDLE,
};
