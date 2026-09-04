import { useCallback, useEffect, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
import { DevAppCapabilityList } from "@/features/devapps/components/DevAppCapabilityList"
import {
  publishDevAppPreviewRuntime,
  releaseDevAppPreviewRuntime,
} from "@/features/devapps/preview/devAppPreviewRuntimeStore"
import { NativeDevAppHost } from "@/features/devapps/native/NativeDevAppHost"
import { WorkbenchTileChrome } from "@/features/workbench/WorkbenchTileChrome"
import { WorkbenchWebDevAppPreviewTile } from "@/features/workbench/WorkbenchWebDevAppPreviewTile"
import type { WorkbenchDevAppPreviewTile as PreviewTileRecord } from "@/features/workbench/model/workbenchStore"
import { usePublishTileActivity } from "@/features/workbench/model/tileActivityStore"
import { defaultNativeDevAppSurface } from "@shared/nativeDevAppManifest"
import type { DevAppPreviewStatus } from "@shared/devAppPreviewTypes"

interface WorkbenchDevAppPreviewTileProps {
  projectId: string
  laneId: string
  tile: PreviewTileRecord
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

type PreviewRenderer = "loading" | "native-react" | "web-app"

/**
 * One development tile chooses an internal renderer from the version-3 manifest. Native React is
 * first-class and renders in Cozea's React tree; adopted web applications reuse the existing
 * isolated web surface without becoming a different product or tile type.
 */
export function WorkbenchDevAppPreviewTile(props: WorkbenchDevAppPreviewTileProps) {
  const sourceWorkspaceId = props.tile.sourceWorkspaceId || props.workspaceId
  const [renderer, setRenderer] = useState<PreviewRenderer>("loading")

  useEffect(() => {
    if (!sourceWorkspaceId) {
      setRenderer("native-react")
      return
    }
    let cancelled = false
    setRenderer("loading")
    void window.electronAPI.devAppAuthoring
      .inspectWorkspace({
        workspaceId: sourceWorkspaceId,
        relativePath: props.tile.relativePath,
      })
      .then((result) => {
        if (cancelled) return
        if (!result.success || result.inspection.status !== "valid") {
          // The native preview owns version-3 diagnostics and the explicit retired-v2 error.
          setRenderer("native-react")
          return
        }
        const surface = defaultNativeDevAppSurface(result.inspection.source.manifest)
        setRenderer(surface.renderer.kind)
      })
      .catch(() => {
        if (!cancelled) setRenderer("native-react")
      })
    return () => {
      cancelled = true
    }
  }, [props.tile.relativePath, sourceWorkspaceId])

  if (renderer === "web-app") return <WorkbenchWebDevAppPreviewTile {...props} />
  if (renderer === "native-react") return <NativeDevAppPreviewTile {...props} />

  return (
    <WorkbenchTileChrome
      title={props.tile.title}
      tileType="devAppPreview"
      panelApi={props.panelApi}
      containerApi={props.containerApi}
      controls={<DevelopmentBadge status={null} hotReload />}
    >
      <PreviewMessage title="Inspecting the DevApp manifest…" detail={null} />
    </WorkbenchTileChrome>
  )
}

function NativeDevAppPreviewTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  panelApi,
  containerApi,
}: WorkbenchDevAppPreviewTileProps) {
  const [status, setStatus] = useState<DevAppPreviewStatus | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [hotReload, setHotReload] = useState(true)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const sourceIdRef = useRef<string | null>(null)
  const runtimeOwnerRef = useRef(Symbol(`native-devapp-preview:${tile.id}`))
  const preview = window.electronAPI?.devAppPreview
  const sourceWorkspaceId = tile.sourceWorkspaceId || workspaceId
  const sourceLaneId = sourceWorkspaceId === workspaceId ? laneId : null

  useEffect(() => {
    publishDevAppPreviewRuntime(runtimeOwnerRef.current, {
      tileId: tile.id,
      relativePath: tile.relativePath,
      status,
      hotReload,
      openError,
    })
  }, [hotReload, openError, status, tile.id, tile.relativePath])

  useEffect(
    () => () => releaseDevAppPreviewRuntime(runtimeOwnerRef.current, tile.id),
    [tile.id],
  )

  useEffect(() => {
    if (!preview || !sourceWorkspaceId || !tile.relativePath) return
    let cancelled = false
    let openedSourceId: string | null = null
    const leaseId = `${tile.id}_${crypto.randomUUID()}`

    void preview
      .open({
        workspaceId: sourceWorkspaceId,
        laneId: sourceLaneId,
        relativePath: tile.relativePath,
        leaseId,
      })
      .then((result) => {
        if (cancelled) {
          if (result.success && result.preview.status !== "invalid") {
            void preview
              .close({ sourceId: result.preview.sourceId, leaseId })
              .catch(() => undefined)
          }
          return
        }
        if (!result.success) {
          setOpenError(result.error)
          return
        }
        setOpenError(null)
        setHotReload(result.preview.hotReload)
        setStatus(result.preview)
        if (result.preview.status !== "invalid") {
          openedSourceId = result.preview.sourceId
          sourceIdRef.current = result.preview.sourceId
          setSourceId(result.preview.sourceId)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOpenError(error instanceof Error ? error.message : "Could not open the preview.")
        }
      })

    return () => {
      cancelled = true
      if (sourceIdRef.current === openedSourceId) {
        sourceIdRef.current = null
        setSourceId(null)
      }
      if (openedSourceId) {
        void preview.close({ sourceId: openedSourceId, leaseId }).catch(() => undefined)
      }
    }
  }, [preview, sourceLaneId, sourceWorkspaceId, tile.id, tile.relativePath])

  useEffect(() => {
    if (!preview) return
    return preview.onStatus((payload) => {
      if (payload.sourceId === sourceIdRef.current) setStatus(payload.status)
    })
  }, [preview])

  const approve = useCallback(() => {
    if (!preview || !sourceId || status?.status !== "needsApproval") return
    setApprovalError(null)
    void preview
      .approve({ sourceId, approvalFingerprint: status.approvalFingerprint })
      .then((result) => {
        if (result.success) setStatus(result.preview)
        else setApprovalError(result.error)
      })
      .catch((error: unknown) => {
        setApprovalError(
          error instanceof Error ? error.message : "Could not approve the preview.",
        )
      })
  }, [preview, sourceId, status])

  const running = status?.status === "running" ? status : null
  usePublishTileActivity(
    tile.id,
    running ? (running.worker?.status === "starting" ? "starting" : "running") : "idle",
  )

  let body
  if (openError) {
    body = <PreviewMessage title="This DevApp could not be opened" detail={openError} />
  } else if (status?.status === "invalid") {
    body = <PreviewDiagnostics status={status} />
  } else if (status?.status === "needsApproval") {
    body = (
      <PreviewApproval status={status} error={approvalError} onApprove={approve} />
    )
  } else if (running?.view.kind === "nativeReact" && sourceWorkspaceId && sourceId) {
    body = (
      <NativeDevAppHost
        appId={running.view.appId}
        appVersion={running.view.appVersion}
        projectId={projectId}
        workspaceId={sourceWorkspaceId}
        surfaceId={running.view.surfaceId}
        instanceId={tile.id}
        moduleUrl={running.view.moduleUrl}
        stylesUrl={running.view.stylesUrl}
        component={running.view.component}
        permissions={running.grant.capabilities}
        generation={running.reloadToken}
        onExecuteCommand={async (commandId, input) => {
          const result = await preview.invokeTool({
            sourceId,
            name: commandId,
            input,
          })
          if (!result.success) throw new Error(result.error)
          return result.result
        }}
      />
    )
  } else if (running?.view.kind === "unavailable") {
    body = <PreviewMessage title={running.view.reason} detail={running.view.fix ?? null} />
  } else if (running) {
    body = (
      <PreviewMessage
        title="This manifest's default surface is not native React"
        detail="Close and reopen the tile after changing its default renderer, or use the web adapter."
      />
    )
  } else {
    body = <PreviewMessage title="Opening native component…" detail={null} />
  }

  return (
    <WorkbenchTileChrome
      title={running?.name || tile.title}
      tileType="devAppPreview"
      panelApi={panelApi}
      containerApi={containerApi}
      controls={<DevelopmentBadge status={status} hotReload={hotReload} />}
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
        <div className="min-h-0 flex-1">{body}</div>
        {running ? <PreviewFooter status={running} /> : null}
      </div>
    </WorkbenchTileChrome>
  )
}

function DevelopmentBadge({
  status,
  hotReload,
}: {
  status: DevAppPreviewStatus | null
  hotReload: boolean
}) {
  const badge = status && status.status !== "invalid" ? status.badge : null
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="rounded-[4px] bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
        title={badge?.detail ?? "Unpublished component code running from this project."}
      >
        {badge?.label ?? "Development"}
      </span>
      {hotReload ? null : (
        <span className="text-[10px] text-muted-foreground" title="Changes require reopening the preview.">
          no watcher
        </span>
      )}
    </span>
  )
}

function PreviewMessage({ title, detail }: { title: string; detail: string | null }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  )
}

function PreviewDiagnostics({
  status,
}: {
  status: Extract<DevAppPreviewStatus, { status: "invalid" }>
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">This package cannot be loaded</p>
          <p className="text-xs text-muted-foreground">Fix the version-3 manifest diagnostics below.</p>
        </div>
        <div className="divide-y divide-border/40 rounded-lg border border-border/60">
          {status.diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.code}-${index}`} className="space-y-1 p-3">
              <p className="text-xs font-medium text-foreground">{diagnostic.message}</p>
              {diagnostic.field ? (
                <p className="font-mono text-[10px] text-muted-foreground">{diagnostic.field}</p>
              ) : null}
              {diagnostic.fix ? (
                <p className="text-[11px] text-muted-foreground">{diagnostic.fix}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewApproval({
  status,
  error,
  onApprove,
}: {
  status: Extract<DevAppPreviewStatus, { status: "needsApproval" }>
  error: string | null
  onApprove: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-sm space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">Allow {status.name} for this session</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Native React UI runs inside Cozea. Privileged work remains in the extension process and is limited to the grant below.
          </p>
        </div>
        <DevAppCapabilityList
          capabilities={status.requested.capabilities}
          agentInvocable={status.requested.agentInvocable}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="button" size="sm" className="w-full" onClick={onApprove}>
          Allow for this session
        </Button>
      </div>
    </div>
  )
}

function PreviewFooter({
  status,
}: {
  status: Extract<DevAppPreviewStatus, { status: "running" }>
}) {
  const blockers = status.preflight.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "blocker",
  ).length
  const worker = status.worker
  if (!worker && blockers === 0) return null
  return (
    <div className="flex min-h-7 shrink-0 items-center gap-3 border-t border-border/50 bg-muted/20 px-3 text-[10px] text-muted-foreground">
      {worker ? (
        <span>
          extension {worker.status}
          {worker.restarts > 0 ? ` · ${worker.restarts} restart${worker.restarts === 1 ? "" : "s"}` : ""}
        </span>
      ) : null}
      {blockers > 0 ? <span>{blockers} issue{blockers === 1 ? "" : "s"} would block publishing</span> : null}
    </div>
  )
}
