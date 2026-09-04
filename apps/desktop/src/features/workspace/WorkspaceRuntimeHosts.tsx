import { memo, useEffect, useMemo } from "react"

import {
  useYjsProject,
} from "@/contexts/YjsProjectContextValue"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { ProjectSyncProviderRuntime } from "@/contexts/project/ProjectSyncProviderRuntime"
import {
  useWorkspaceRuntimeStore,
  type WorkspaceRuntimeRecord,
} from "@/features/workspace/useWorkspaceRuntimeStore"
import { selectHostedWorkspaceRuntimeRecords } from "@/features/workspace/workspaceRuntimePolicy"

function WorkspaceRuntimeObserver({ runtimeId }: { runtimeId: string }) {
  const yjsContext = useYjsProject()
  const syncContext = useOptionalProjectSyncContext()
  const publishSyncContext = useWorkspaceRuntimeStore((state) => state.actions.publishSyncContext)
  const publishYjsContext = useWorkspaceRuntimeStore((state) => state.actions.publishYjsContext)
  const clearPublishedContexts = useWorkspaceRuntimeStore((state) => state.actions.clearPublishedContexts)

  useEffect(() => {
    publishSyncContext(runtimeId, syncContext)
  }, [publishSyncContext, runtimeId, syncContext])

  useEffect(() => {
    publishYjsContext(runtimeId, yjsContext)
  }, [publishYjsContext, runtimeId, yjsContext])

  useEffect(() => {
    return () => {
      clearPublishedContexts(runtimeId)
    }
  }, [clearPublishedContexts, runtimeId])

  return null
}

// Memoized so a write to one runtime record does not re-render every other
// host (records keep identity unless actually touched).
const WorkspaceRuntimeHost = memo(function WorkspaceRuntimeHost({ record }: { record: WorkspaceRuntimeRecord }) {
  const { config, runtimeId, workspaceId } = record

  if (!config.projectId || !config.userId || !config.workspaceId) {
    return null
  }

  return (
    <ProjectSyncProviderRuntime
      projectId={config.projectId}
      userId={config.userId}
      userName={config.userName}
      laneId={config.laneId}
      workspaceId={workspaceId}
      workspaceRevision={config.workspaceRevision}
      projectSlug={config.projectSlug}
      gitCwd={config.gitCwd}
      lastSyncAt={config.lastSyncAt ?? undefined}
      collaborationEnabled={config.collaborationEnabled}
      activeBranch={config.activeBranch}
      sharedBranch={config.sharedBranch}
      documentScopeId={config.documentScopeId}
      renderDeleteConflictDialog={false}
    >
      <WorkspaceRuntimeObserver runtimeId={runtimeId} />
    </ProjectSyncProviderRuntime>
  )
})

export function WorkspaceRuntimeHosts() {
  const runtimes = useWorkspaceRuntimeStore((state) => state.runtimes)
  const refreshLifecycles = useWorkspaceRuntimeStore((state) => state.actions.refreshLifecycles)

  const runtimeRecords = useMemo(
    () =>
      Object.values(runtimes)
        .filter((record) => record.lifecycle !== "closed")
        .sort((left, right) => left.createdAt - right.createdAt),
    [runtimes],
  )
  const hostedRuntimeRecords = useMemo(
    () => selectHostedWorkspaceRuntimeRecords(runtimeRecords),
    [runtimeRecords],
  )

  // Per-window file-change interest roots: the workspace git roots this window
  // hosts. Empty roots make the main process broadcast every external file
  // change to every window, so keep this populated from the live hosts.
  const interestRoots = useMemo(() => {
    const seen = new Set<string>()
    const roots: string[] = []

    for (const record of hostedRuntimeRecords) {
      const root = record.config.gitCwd?.trim()
      if (!root || seen.has(root)) {
        continue
      }
      seen.add(root)
      roots.push(root)
    }

    return roots
  }, [hostedRuntimeRecords])

  useEffect(() => {
    const yjsApi = window.electronAPI?.yjs
    if (!yjsApi?.setInterestRoots) {
      return
    }

    void yjsApi.setInterestRoots({ roots: interestRoots }).catch((error) => {
      console.warn("[WorkspaceRuntimeHosts] Failed to update Yjs interest roots", error)
    })
  }, [interestRoots])

  useEffect(() => {
    refreshLifecycles()
    const interval = window.setInterval(() => {
      refreshLifecycles()
    }, 15_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [refreshLifecycles])

  if (hostedRuntimeRecords.length === 0) {
    return null
  }

  return (
    <>
      {hostedRuntimeRecords.map((record) => (
        <WorkspaceRuntimeHost key={record.runtimeId} record={record} />
      ))}
    </>
  )
}
