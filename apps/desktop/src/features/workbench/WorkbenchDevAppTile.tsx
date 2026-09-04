import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { NativeDevAppSurfaceHost } from "@/features/devapps/native-runtime/NativeDevAppSurfaceHost"
import { createNativeDevAppHostClient } from "@/features/devapps/native-runtime/createNativeDevAppHostClient"
import type { WorkbenchDevAppTile as WorkbenchDevAppTileRecord } from "@/lib/workbenchTileContract"
import type { PreparedDevAppSurfaceV3 } from "@shared/devAppInstallationV3"

interface WorkbenchDevAppTileProps {
  projectId: string
  laneId: string
  workspaceId: string | null
  tile: WorkbenchDevAppTileRecord
}

export function WorkbenchDevAppTile({
  projectId,
  laneId,
  workspaceId,
  tile,
}: WorkbenchDevAppTileProps) {
  const [surface, setSurface] = useState<PreparedDevAppSurfaceV3 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    void window.electronAPI.devApp
      .prepareSurface({
        installationId: tile.installationId,
        surfaceId: tile.surfaceId,
      })
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setSurface(null)
          setError(result.error)
          return
        }
        setSurface(result.surface)
      })
      .catch((cause) => {
        if (!cancelled) {
          setSurface(null)
          setError(cause instanceof Error ? cause.message : "The DevApp could not open.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [attempt, tile.installationId, tile.surfaceId])

  useEffect(
    () =>
      window.electronAPI.devApp.onInstallationsChanged((installations) => {
        if (!installations.some((installation) => installation.installationId === tile.installationId)) {
          setSurface(null)
          setError("This DevApp is no longer installed.")
          return
        }
        setAttempt((value) => value + 1)
      }),
    [tile.installationId],
  )

  const host = useMemo(() => {
    if (!surface || surface.kind !== "nativeReact") return null
    return createNativeDevAppHostClient({
      identity: {
        installationId: surface.installationId,
        appId: surface.appId,
        version: surface.appVersion,
      },
      surface: {
        surfaceId: surface.surfaceId,
        instanceId: tile.id,
        projectId,
        workspaceId,
        laneId,
      },
    })
  }, [laneId, projectId, surface, tile.id, workspaceId])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <p className="text-sm font-medium text-foreground">DevApp unavailable</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!surface) return <div className="h-full bg-content-surface" aria-busy="true" />

  if (surface.kind === "webApp") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-sm font-medium text-foreground">Web application surface</p>
          <p className="text-xs text-muted-foreground">
            This installation is valid. Its isolated browser adapter is not active in this build.
          </p>
        </div>
      </div>
    )
  }

  if (!host) return null
  return (
    <NativeDevAppSurfaceHost
      moduleUrl={surface.moduleUrl}
      stylesUrl={surface.stylesUrl}
      componentName={surface.component}
      host={host}
      onError={(nextError) => setError(nextError.message)}
    />
  )
}
