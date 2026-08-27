import {
  buildDevServerRunKey,
  stopDevServerRun,
} from "@/features/projects/devserver/devServerRunStore";
import type { WorkbenchRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntime";
import { useTerminalStore } from "@/stores/useTerminalStore";

/** Release bindings owned by an auxiliary source-project session. */
export async function releaseProjectDevAppRuntimeTarget(
  target: WorkbenchRuntimeTarget,
  tileId: string,
): Promise<void> {
  if (!target.usesProjectDevAppSource || !target.workspaceId) {
    return;
  }

  const runKey = buildDevServerRunKey(target.workspaceId, target.laneId);
  await stopDevServerRun(runKey).catch((error) => {
    console.warn("[ProjectDevApp] Failed to stop the source runtime", error);
  });

  const session = await window.electronAPI.workbenchSession.ensureSession({
    projectId: target.projectId,
    laneId: target.laneId,
    workspaceId: target.workspaceId,
  });

  await window.electronAPI.workbenchSession
    .releaseBrowser({
      sessionKey: session.sessionKey,
      projectId: target.projectId,
      laneId: target.laneId,
      tileId,
    })
    .catch((error) => {
      console.warn("[ProjectDevApp] Failed to release the source browser binding", error);
    });

  const terminalResult = await window.electronAPI.workbenchSession
    .releaseTerminal({
      sessionKey: session.sessionKey,
      projectId: target.projectId,
      laneId: target.laneId,
      tileId,
      close: true,
    })
    .catch((error) => {
      console.warn("[ProjectDevApp] Failed to release the source terminal binding", error);
      return null;
    });

  if (terminalResult?.terminalId) {
    useTerminalStore.getState().actions.removeTerminal(terminalResult.terminalId);
  }
}
