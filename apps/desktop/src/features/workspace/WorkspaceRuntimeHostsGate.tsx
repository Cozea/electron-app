import { lazy, Suspense, useEffect, useMemo, useState } from "react"

import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import {
  hasHostableWorkspaceRuntime,
  hasImmediateWorkspaceRuntimeHost,
} from "@/features/workspace/workspaceRuntimePolicy"

const LazyWorkspaceRuntimeHosts = lazy(() =>
  import("@/features/workspace/WorkspaceRuntimeHosts").then((module) => ({
    default: module.WorkspaceRuntimeHosts,
  })),
)

export function WorkspaceRuntimeHostsGate() {
  const [canLoadHost, setCanLoadHost] = useState(false)
  const hostLoadMode = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) => {
        const records = Object.values(state.runtimes)
        if (!hasHostableWorkspaceRuntime(records)) {
          return "none" as const
        }
        return hasImmediateWorkspaceRuntimeHost(records) ? "immediate" as const : "idle" as const
      },
      [],
    ),
  )
  const shouldHostRuntimes = hostLoadMode !== "none"

  useEffect(() => {
    if (!shouldHostRuntimes) {
      setCanLoadHost(false)
      return
    }
    if (hostLoadMode === "immediate") {
      setCanLoadHost(true)
      return
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }
    let idleHandle: number | null = null
    const timeoutHandle = window.setTimeout(() => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(() => setCanLoadHost(true), {
          timeout: 3_000,
        })
        return
      }

      setCanLoadHost(true)
    }, 1_200)

    return () => {
      window.clearTimeout(timeoutHandle)
      if (idleHandle !== null) {
        idleWindow.cancelIdleCallback?.(idleHandle)
      }
    }
  }, [hostLoadMode, shouldHostRuntimes])

  if (!shouldHostRuntimes || !canLoadHost) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <LazyWorkspaceRuntimeHosts />
    </Suspense>
  )
}
