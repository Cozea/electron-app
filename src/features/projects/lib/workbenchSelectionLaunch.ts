import type { ProviderKind } from "@cozea/assistant-contracts"

import { getDevAppById } from "@/features/devapps/registry"
import type { DevAppLaunchRequest } from "@/features/devapps/registry/types"

export type WorkbenchSelectionLaunchRequest = DevAppLaunchRequest

export interface WorkbenchSelectionCreateOptions {
  title?: string
  provider?: ProviderKind
  devAppId?: string | null
  devAppReleaseId?: string | null
  devAppReleaseVersion?: number | null
  devAppProjectId?: string | null
  devAppWorkspaceId?: string | null
  devAppLaneId?: string | null
  devAppFramework?: string | null
  devAppCommand?: string | null
  devAppPort?: number | null
  autoStart?: boolean
}

export interface ResolvedWorkbenchSelectionAddTileAction {
  action: "addTile"
  tileType: "assistantChat" | "browser" | "terminal"
  options?: WorkbenchSelectionCreateOptions
}

export interface ResolvedWorkbenchSelectionSingletonAction {
  action: "openSingletonTile"
  tileType: "devServer" | "mobileSimulator"
  options?: WorkbenchSelectionCreateOptions
}

export type ResolvedWorkbenchSelectionLaunchAction =
  | ResolvedWorkbenchSelectionAddTileAction
  | ResolvedWorkbenchSelectionSingletonAction

export function resolveWorkbenchSelectionLaunchRequest(
  request: WorkbenchSelectionLaunchRequest,
): ResolvedWorkbenchSelectionLaunchAction {
  if (request.projectDevApp) {
    const devApp = request.projectDevApp
    if (request.appId !== `project-devapp:${devApp.publicationId}`) {
      throw new Error(`Invalid project DevApp launch request for "${request.appId}"`)
    }

    return {
      action: "openSingletonTile",
      tileType: "devServer",
      options: {
        title: devApp.name,
        devAppId: devApp.publicationId,
        devAppReleaseId: devApp.releaseId,
        devAppReleaseVersion: devApp.releaseVersion,
        devAppProjectId: devApp.projectId,
        devAppWorkspaceId: devApp.sourceWorkspaceId ?? null,
        devAppLaneId: devApp.sourceLaneId ?? null,
        devAppFramework: devApp.framework,
        devAppCommand: devApp.devCommand,
        devAppPort: devApp.devPort ?? null,
        autoStart: true,
      },
    }
  }

  const manifest = getDevAppById(request.appId)
  if (!manifest || !manifest.launcher.enabled) {
    throw new Error(`Unknown DevApp "${request.appId}"`)
  }

  const commonOptions: WorkbenchSelectionCreateOptions = {
    title: manifest.name,
  }

  switch (manifest.launch.kind) {
    case "assistantChat":
      return {
        action: "addTile",
        tileType: "assistantChat",
        options: {
          ...commonOptions,
          provider: manifest.launch.provider,
        },
      }
    case "browser":
      return {
        action: "addTile",
        tileType: "browser",
        options: commonOptions,
      }
    case "terminal":
      return {
        action: "addTile",
        tileType: "terminal",
        options: commonOptions,
      }
    case "devServer":
      return {
        action: "openSingletonTile",
        tileType: "devServer",
        options: commonOptions,
      }
    case "mobileSimulator":
      return {
        action: "openSingletonTile",
        tileType: "mobileSimulator",
        options: commonOptions,
      }
  }

  throw new Error(`Unsupported DevApp launch request for "${manifest.id}"`)
}
