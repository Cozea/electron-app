import { memo, useEffect, useMemo, useState } from "react"

import {
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
  useYjsProject,
  YjsProjectContextBridgeProvider,
} from "@/contexts/YjsProjectContextValue"
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext"
import { ProjectSyncProviderRuntime } from "@/contexts/project/ProjectSyncProviderRuntime"
import { IDLE_SYNC_PROGRESS, ProjectSyncContext } from "@/contexts/project/projectSyncShared"
import {
  useWorkspaceRuntimeStore,
  type WorkspaceRuntimeRecord,
} from "@/lib/workspaceRuntimeStore"
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


function CollaborationWorkspaceRuntimeHost({ record, sessionId }: { record: WorkspaceRuntimeRecord; sessionId: string }) {
  const { runtimeId, workspaceId, config } = record
  const publishSyncContext = useWorkspaceRuntimeStore(state => state.actions.publishSyncContext)
  const publishYjsContext = useWorkspaceRuntimeStore(state => state.actions.publishYjsContext)
  const clearPublishedContexts = useWorkspaceRuntimeStore(state => state.actions.clearPublishedContexts)
  const [snapshot, setSnapshot] = useState<import("@shared/collaborationRuntime").SessionRuntimeSnapshot | null>(null)
  const runtime = window.electronAPI.collaboration.runtime
  useEffect(() => {
    let alive = true
    const refresh = () => void runtime.snapshot(sessionId).then(value => { if (alive) setSnapshot(value) }).catch(() => { if (alive) setSnapshot(null) })
    refresh(); const unsubscribe = runtime.onChanged(changed => { if (changed === sessionId) refresh() })
    return () => { alive = false; unsubscribe() }
  }, [runtime, sessionId])
  const syncContext = useMemo(() => snapshot ? {
    isSynced: true, cloudSyncBlocked: false, lastSyncAt: Date.now(), workspaceId, gitCwd: config.gitCwd,
    collaborationEnabled: true, collaborationMode: "shared" as const, activeBranch: config.activeBranch,
    sharedBranch: config.sharedBranch, collabSessionStatus: snapshot.error ? "error" as const : "ready" as const,
    collabSessionError: snapshot.error, collabEncryptionStatus: "ready" as const,
    triggerSync: async () => { await runtime.retry(sessionId) }, syncProgress: IDLE_SYNC_PROGRESS,
  } : null, [config.activeBranch, config.gitCwd, config.sharedBranch, runtime, sessionId, snapshot, workspaceId])
  useEffect(() => {
    publishSyncContext(runtimeId, syncContext); publishYjsContext(runtimeId, EMPTY_YJS_PROJECT_CONTEXT_VALUE)
    return () => clearPublishedContexts(runtimeId)
  }, [clearPublishedContexts, publishSyncContext, publishYjsContext, runtimeId, syncContext])
  return <ProjectSyncContext.Provider value={syncContext}><YjsProjectContextBridgeProvider value={EMPTY_YJS_PROJECT_CONTEXT_VALUE}>
    <WorkspaceRuntimeObserver runtimeId={runtimeId} /></YjsProjectContextBridgeProvider></ProjectSyncContext.Provider>
}

// Memoized so a write to one runtime record does not re-render every other
// host (records keep identity unless actually touched).
const WorkspaceRuntimeHost = memo(function WorkspaceRuntimeHost({ record }: { record: WorkspaceRuntimeRecord }) {
  const { config, runtimeId, workspaceId } = record

  if (!config.projectId || !config.principalId || !config.workspaceId) return null
  const sessionId = config.laneId?.startsWith("session:") ? config.laneId.slice("session:".length) : null
  if (sessionId) return <CollaborationWorkspaceRuntimeHost record={record} sessionId={sessionId} />

  return (
    <ProjectSyncProviderRuntime
      projectId={config.projectId}
      principalId={config.principalId}
      displayName={config.displayName}
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
