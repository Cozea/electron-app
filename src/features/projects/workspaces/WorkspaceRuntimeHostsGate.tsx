import { lazy, Suspense, useEffect, useMemo, useState } from "react"

import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"

const LazyWorkspaceRuntimeHosts = lazy(() =>
  import("@/features/projects/workspaces/WorkspaceRuntimeHosts").then((module) => ({
    default: module.WorkspaceRuntimeHosts,
  })),
)

export function WorkspaceRuntimeHostsGate() {
  const [canLoadHost, setCanLoadHost] = useState(false)
  const shouldHostRuntimes = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) =>
        Object.values(state.runtimes).some(
          (record) =>
            record.lifecycle !== "closed" &&
            record.lifecycle !== "background-frozen" &&
            Boolean(record.config.projectId && record.config.userId && record.config.localPath),
        ),
      [],
    ),
  )

  useEffect(() => {
    if (!shouldHostRuntimes) {
      setCanLoadHost(false)
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
  }, [shouldHostRuntimes])

  if (!shouldHostRuntimes || !canLoadHost) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <LazyWorkspaceRuntimeHosts />
    </Suspense>
  )
}
