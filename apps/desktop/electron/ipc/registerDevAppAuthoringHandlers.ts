import type { IpcMain } from "electron";

import { getCatalogSnapshot } from "../workspaces/CatalogSnapshot";
import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization";
import type { DevAppAuthoringService } from "../services/DevAppAuthoringService";
import type { DevAppScaffoldStarter } from "../../../../shared/devAppAuthoringTypes";

interface RegisterDevAppAuthoringHandlersDeps {
  service: DevAppAuthoringService;
}

function isStarter(value: unknown): value is DevAppScaffoldStarter {
  return value === "view" || value === "worker" || value === "view-worker";
}

export function registerDevAppAuthoringHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevAppAuthoringHandlersDeps,
): void {
  ipcMain.handle(
    "devAppAuthoring:inspectWorkspace",
    async (
      _event,
      options: {
        workspaceId: string;
        relativePath?: string;
      },
    ) => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          operation: "read-file",
        });
        return {
          success: true as const,
          inspection: deps.service.inspect({
            projectId: access.workspace.projectId,
            workspaceId: options.workspaceId,
            workspaceRoot: access.projectRootPath,
            relativePath: options.relativePath,
          }),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Could not inspect this DevApp.",
        };
      }
    },
  );

  ipcMain.handle(
    "devAppAuthoring:inspectFolder",
    async (_event, options: { folderPath: string }) => {
      try {
        if (typeof options?.folderPath !== "string" || !options.folderPath.trim()) {
          throw new Error("Choose a folder to inspect.");
        }
        return {
          success: true as const,
          inspection: deps.service.inspectFolder(options.folderPath),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Could not inspect this folder.",
        };
      }
    },
  );

  ipcMain.handle("devAppAuthoring:listDevelopmentSources", async () => {
    try {
      const snapshot = await getCatalogSnapshot();
      const sources = Object.values(snapshot.entries)
        .flatMap((entry) => {
          if (entry.status !== "ready") return [];
          try {
            const inspection = deps.service.inspect({
              projectId: entry.projectId,
              workspaceId: entry.workspace.workspaceId,
              workspaceRoot: entry.workspace.projectRootPath,
            });
            return inspection.status === "valid" ? [inspection.source] : [];
          } catch {
            // One detached or unreadable project must not remove every other
            // development package from Add Tile.
            return [];
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      return { success: true as const, sources };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Could not list development DevApps.",
      };
    }
  });

  ipcMain.handle(
    "devAppAuthoring:scaffold",
    async (
      _event,
      options: {
        workspaceId: string;
        name: string;
        starter: DevAppScaffoldStarter;
      },
    ) => {
      try {
        if (!isStarter(options?.starter)) throw new Error("Choose a supported DevApp starter.");
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          operation: "write-file",
        });
        return {
          success: true as const,
          ...deps.service.scaffold({
            projectId: access.workspace.projectId,
            workspaceId: options.workspaceId,
            workspaceRoot: access.projectRootPath,
            name: options.name,
            starter: options.starter,
          }),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Could not create the DevApp starter.",
        };
      }
    },
  );
}
