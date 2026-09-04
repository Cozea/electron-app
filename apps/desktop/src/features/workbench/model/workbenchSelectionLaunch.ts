import type { ProviderKind } from "@cozea/assistant-contracts"

import { getDevAppById } from "@/features/devapps/registry"
import type { DevAppLaunchRequest } from "@/features/devapps/registry/types"

export type WorkbenchSelectionLaunchRequest = DevAppLaunchRequest

export interface WorkbenchSelectionCreateOptions {
  title?: string
  provider?: ProviderKind
  url?: string
  storageScope?: import("@shared/browserTileTypes").BrowserStorageScope
  devAppId?: string | null
  devAppReleaseId?: string | null
  devAppReleaseVersion?: number | null
  devAppRef?: string | null
  devAppPreviewRelativePath?: string | null
  devAppPreviewSourceProjectId?: string | null
  devAppPreviewSourceWorkspaceId?: string | null
  orgDevAppPublicationId?: string | null
  orgDevAppOrganizationId?: string | null
  orgDevAppContentHash?: string | null
  orgDevAppEntryPath?: string | null
  orgDevAppRuntimeKind?: "static" | "service" | null
  orgDevAppLogoDataUrl?: string | null
  autoStart?: boolean
}

export interface ResolvedWorkbenchSelectionAddTileAction {
  action: "addTile"
  tileType: "assistantChat" | "browser" | "terminal" | "orgDevApp" | "devAppPreview"
  options?: WorkbenchSelectionCreateOptions
}

export interface ResolvedWorkbenchSelectionSingletonAction {
  action: "openSingletonTile"
  tileType: "devServer" | "mobileSimulator" | "llama" | "memory"
  options?: WorkbenchSelectionCreateOptions
}

export type ResolvedWorkbenchSelectionLaunchAction =
  | ResolvedWorkbenchSelectionAddTileAction
  | ResolvedWorkbenchSelectionSingletonAction

export function resolveWorkbenchSelectionLaunchRequest(
  request: WorkbenchSelectionLaunchRequest,
): ResolvedWorkbenchSelectionLaunchAction {
  if (request.developmentDevApp) {
    const devApp = request.developmentDevApp
    if (request.appId !== `development-devapp:${devApp.sourceId}`) {
      throw new Error(`Invalid development DevApp launch request for "${request.appId}"`)
    }
    return {
      action: "addTile",
      tileType: "devAppPreview",
      options: {
        title: devApp.name,
        devAppRef: devApp.ref,
        devAppPreviewRelativePath: devApp.relativePath,
        devAppPreviewSourceProjectId: devApp.projectId,
        devAppPreviewSourceWorkspaceId: devApp.workspaceId,
      },
    }
  }
  if (request.publishedDevApp) {
    const devApp = request.publishedDevApp
    if (request.appId !== `org-devapp:${devApp.publicationId}`) {
      throw new Error(`Invalid org DevApp launch request for "${request.appId}"`)
    }

    return {
      action: "addTile",
      tileType: "orgDevApp",
      options: {
        title: devApp.name,
        url: "",
        storageScope: "orgDevApp",
        devAppRef: devApp.ref,
        devAppId: devApp.publicationId,
        devAppReleaseId: devApp.releaseId,
        devAppReleaseVersion: devApp.releaseVersion,
        orgDevAppPublicationId: devApp.publicationId,
        orgDevAppOrganizationId: devApp.organizationId,
        orgDevAppContentHash: devApp.contentHash,
        orgDevAppEntryPath: devApp.entryPath,
        orgDevAppRuntimeKind: devApp.runtimeKind,
        orgDevAppLogoDataUrl: devApp.logoDataUrl ?? null,
      },
    }
  }

  if (request.projectDevApp) {
    throw new Error("Localhost project DevApps are no longer a consumer launch path")
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
    case "llama":
      return {
        action: "openSingletonTile",
        tileType: "llama",
        options: commonOptions,
      }
    case "memory":
      return {
        action: "openSingletonTile",
        tileType: "memory",
        options: commonOptions,
      }
    case "publishedDevApp":
    case "projectDevApp":
    case "developmentDevApp":
      throw new Error(`Unsupported DevApp launch request for "${manifest.id}"`)
  }

  throw new Error(`Unsupported DevApp launch request for "${manifest.id}"`)
}
