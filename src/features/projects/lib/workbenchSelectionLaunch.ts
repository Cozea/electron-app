import type { ProviderKind } from "@cozea/assistant-contracts"

import { getDevAppById } from "@/features/devapps/registry"
import type { DevAppLaunchRequest } from "@/features/devapps/registry/types"

export type WorkbenchSelectionLaunchRequest = DevAppLaunchRequest

export interface WorkbenchSelectionCreateOptions {
  title?: string
  provider?: ProviderKind
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
