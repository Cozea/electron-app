import { useEffect, useMemo } from "react"

import {
  useYjsProject,
} from "@/contexts/YjsProjectContextValue"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { ProjectSyncProviderRuntime } from "@/features/projects/contexts/ProjectSyncProviderRuntime"
import {
  useWorkspaceRuntimeStore,
  type WorkspaceRuntimeRecord,
} from "@/features/projects/workspaces/useWorkspaceRuntimeStore"
import { selectHostedWorkspaceRuntimeRecords } from "@/features/projects/workspaces/workspaceRuntimePolicy"

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

function WorkspaceRuntimeHost({ record }: { record: WorkspaceRuntimeRecord }) {
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
}

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

  useEffect(() => {
    const yjsApi = window.electronAPI?.yjs
    if (!yjsApi?.setInterestRoots) {
      return
    }

    // Prefer concrete workspace roots. Empty roots clear the interest map and
    // fall back to broadcasting every file event to the renderer.
    const roots = hostedRuntimeRecords
      .map((record) => record.workspaceId)
      .filter((workspaceId): workspaceId is string => Boolean(workspaceId?.trim()))

    void yjsApi.setInterestRoots({ roots }).catch((error) => {
      console.warn("[WorkspaceRuntimeHosts] Failed to update Yjs interest roots", error)
    })
  }, [hostedRuntimeRecords])

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
