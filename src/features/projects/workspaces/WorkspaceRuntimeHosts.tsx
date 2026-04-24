import { useEffect, useMemo } from "react"

import {
  useYjsProject,
} from "@/contexts/YjsProjectContextValue"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { ProjectSyncProviderRuntime } from "@/features/projects/contexts/ProjectSyncProviderRuntime"
import { normalizeWorkspaceProjectPath } from "@/features/projects/workspaces/workspaceIdentity"
import {
  useWorkspaceRuntimeStore,
  type WorkspaceRuntimeRecord,
} from "@/features/projects/workspaces/useWorkspaceRuntimeStore"
import { selectHostedWorkspaceRuntimeRecords } from "@/features/projects/workspaces/workspaceRuntimePolicy"

function WorkspaceRuntimeObserver({ workspaceId }: { workspaceId: string }) {
  const yjsContext = useYjsProject()
  const syncContext = useOptionalProjectSyncContext()
  const publishSyncContext = useWorkspaceRuntimeStore((state) => state.actions.publishSyncContext)
  const publishYjsContext = useWorkspaceRuntimeStore((state) => state.actions.publishYjsContext)
  const clearPublishedContexts = useWorkspaceRuntimeStore((state) => state.actions.clearPublishedContexts)

  useEffect(() => {
    publishSyncContext(workspaceId, syncContext)
  }, [publishSyncContext, syncContext, workspaceId])

  useEffect(() => {
    publishYjsContext(workspaceId, yjsContext)
  }, [publishYjsContext, workspaceId, yjsContext])

  useEffect(() => {
    return () => {
      clearPublishedContexts(workspaceId)
    }
  }, [clearPublishedContexts, workspaceId])

  return null
}

function WorkspaceRuntimeHost({ record }: { record: WorkspaceRuntimeRecord }) {
  const { config, workspaceId } = record

  if (!config.projectId || !config.userId || !config.localPath) {
    return null
  }

  return (
    <ProjectSyncProviderRuntime
      projectId={config.projectId}
      userId={config.userId}
      userName={config.userName}
      laneId={config.laneId}
      projectSlug={config.projectSlug}
      localPath={config.localPath}
      gitCwd={config.gitCwd}
      lastSyncAt={config.lastSyncAt ?? undefined}
      collaborationEnabled={config.collaborationEnabled}
      activeBranch={config.activeBranch}
      sharedBranch={config.sharedBranch}
      documentScopeId={config.documentScopeId}
      renderDeleteConflictDialog={false}
    >
      <WorkspaceRuntimeObserver workspaceId={workspaceId} />
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

  const interestRoots = useMemo(() => {
    const seen = new Set<string>()
    const roots: string[] = []

    for (const record of hostedRuntimeRecords) {
      const normalizedRoot = normalizeWorkspaceProjectPath(record.config.localPath)
      if (!normalizedRoot || seen.has(normalizedRoot)) {
        continue
      }
      seen.add(normalizedRoot)
      roots.push(normalizedRoot)
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
        <WorkspaceRuntimeHost key={record.workspaceId} record={record} />
      ))}
    </>
  )
}
