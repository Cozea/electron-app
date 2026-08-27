import { useEffect, useMemo, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchBrowserView } from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import {
  type WorkbenchOrgDevAppTile as WorkbenchOrgDevAppTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { buildOrgDevAppUrl } from "@shared/orgDevAppProtocol"
import { useTranslation } from "@/lib/i18n"

interface WorkbenchOrgDevAppTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchOrgDevAppTileRecord
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchOrgDevAppTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  workbenchSessionKey,
  panelApi,
  containerApi,
}: WorkbenchOrgDevAppTileProps) {
  const { t } = useTranslation()
  const { convexUserId } = useAuth()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [originUrl, setOriginUrl] = useState(tile.url)

  const artifact = useQuery(
    api.devApps.getArtifactUrl,
    convexUserId && tile.publicationId
      ? {
          userId: convexUserId,
          publicationId: tile.publicationId as Id<"devAppPublications">,
        }
      : "skip",
  )

  useEffect(() => {
    if (!artifact) return
    let cancelled = false
    setPrepareError(null)
    void window.electronAPI.orgDevApp
      .prepareArtifact({
        downloadUrl: artifact.url,
        contentHash: artifact.contentHash,
        entryPath: artifact.entryPath,
      })
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setPrepareError(result.error)
          return
        }
        setOriginUrl(result.originUrl)
      })
      .catch((error) => {
        if (cancelled) return
        setPrepareError(error instanceof Error ? error.message : t("orgDevApp.open.failed"))
      })
    return () => {
      cancelled = true
    }
  }, [artifact, laneId, projectId, t, tile.id, workbenchActions, workspaceId])

  const resolvedUrl = originUrl || (tile.contentHash
    ? buildOrgDevAppUrl({ contentHash: tile.contentHash, entryPath: tile.entryPath })
    : "")

  const {
    hostRef,
    state,
    boundsReady,
    overlayPaused,
    placeholderScreenshot,
    actions,
  } = useWorkbenchBrowserView({
    tileId: tile.id,
    url: resolvedUrl,
    sessionKey: workbenchSessionKey,
    projectId,
    laneId,
    workspaceId: tile.publicationId,
    visible: panelActivity.visible && Boolean(resolvedUrl) && !prepareError,
    persistModel: true,
    storageScope: "orgDevApp",
    partitionKey: tile.publicationId,
    navigationPolicy: "orgDevApp",
    onTitleObserved: (title) => {
      workbenchActions.updateTileTitle(projectId, laneId, tile.id, title, workspaceId)
    },
  })

  const statusMessage = useMemo(() => {
    if (prepareError) return prepareError
    if (!resolvedUrl || state.isLoading) return t("orgDevApp.open.preparing")
    return null
  }, [prepareError, resolvedUrl, state.isLoading, t])

  return (
    <WorkbenchTileChrome
      title={tile.title}
      panelApi={panelApi}
      containerApi={containerApi}
      chromeVariant="pill"
      tileType="orgDevApp"
      devAppId={tile.publicationId}
      logoDataUrl={tile.logoDataUrl}
      hideTitlePill={false}
      contentClassName="relative h-full overflow-hidden bg-content-surface"
    >
      {statusMessage && (!boundsReady || prepareError) ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{statusMessage}</p>
        </div>
      ) : null}
      <div ref={hostRef} className="absolute inset-0" />
      {overlayPaused && placeholderScreenshot ? (
        <img
          alt=""
          src={placeholderScreenshot}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {state.loadError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-center">
          <p className="max-w-md text-sm text-destructive">{state.loadError}</p>
        </div>
      ) : null}
      <button
        type="button"
        className="sr-only"
        onClick={() => {
          void actions.reload()
        }}
      >
        Reload
      </button>
    </WorkbenchTileChrome>
  )
}
