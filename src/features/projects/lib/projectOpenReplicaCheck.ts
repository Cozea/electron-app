import type { GitReplicaPlanResult } from "@shared/electronApiTypes"
import { getMeaningfulLocalFileCount, isBootstrapOnlyLocalPath } from "./localWorkspaceState"
import { isReplicaSyncEntitlementError } from "./replicaErrorPresentation"

function hasMeaningfulLocalMutations(plan: GitReplicaPlanResult): boolean {
  const hasMeaningfulUploads = plan.uploads.some((entry) => !isBootstrapOnlyLocalPath(entry.path))
  const hasMeaningfulLocalDeletes = plan.localDeletes.some(
    (entry) => !isBootstrapOnlyLocalPath(entry.path)
  )
  const hasMeaningfulConflicts = plan.conflicts.some((entry) => !isBootstrapOnlyLocalPath(entry.path))
  const hasMeaningfulAutoMerged = (plan.autoMerged ?? []).some(
    (entry) => !isBootstrapOnlyLocalPath(entry.path)
  )

  return (
    hasMeaningfulUploads ||
    hasMeaningfulLocalDeletes ||
    hasMeaningfulConflicts ||
    hasMeaningfulAutoMerged
  )
}

export interface ProjectOpenReplicaCheckOptions {
  projectId: string
  projectPath: string
}

export interface ProjectOpenReplicaCheckResult {
  gateSyncScreen: boolean
  hasConflicts: boolean
  likelyLocalWipe: boolean
  totalChanges: number
  plan: GitReplicaPlanResult
  syncAccessBlocked: boolean
}

function createEmptyReplicaPlan(): GitReplicaPlanResult {
  return {
    success: true,
    sessionId: "local-only",
    downloads: [],
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    autoMerged: [],
    conflicts: [],
    noChange: 0,
  }
}

function canOpenProjectLocally(meaningfulLocalFileCount: number | null): boolean {
  return meaningfulLocalFileCount !== null && meaningfulLocalFileCount > 0
}

function isLikelyLocalWorkspaceWipe(
  plan: GitReplicaPlanResult,
  meaningfulLocalFileCount: number | null
): boolean {
  if (meaningfulLocalFileCount !== 0) {
    return false
  }

  const hasNoLocalMutations = !hasMeaningfulLocalMutations(plan)

  if (!hasNoLocalMutations) {
    return false
  }

  // Replica plans may represent a wiped local workspace as either:
  // 1) pure cloudDeletes (legacy shape), or
  // 2) pure downloads to restore missing local files (current shape).
  return plan.downloads.length > 0 || plan.cloudDeletes.length > 0
}

export async function runProjectOpenReplicaCheck({
  projectId,
  projectPath,
}: ProjectOpenReplicaCheckOptions): Promise<ProjectOpenReplicaCheckResult> {
  console.log("[ReplicaOpenCheck] Starting pre-open replica check", {
    projectId,
    projectPath,
  })

  const bootstrap = await window.electronAPI.sync.gitReplicaBootstrap({
    projectId,
    projectPath,
  })
  let localFileCount: number | null = null
  let meaningfulLocalFileCount: number | null = null
  const localFiles = await window.electronAPI.project.listFiles({ projectPath })
  if (localFiles.success) {
    const localPaths = (localFiles.files ?? []).map((entry) => entry.path)
    localFileCount = localPaths.length
    meaningfulLocalFileCount = getMeaningfulLocalFileCount(localPaths)
  }

  if (!bootstrap.success) {
    if (isReplicaSyncEntitlementError(bootstrap.error) && canOpenProjectLocally(meaningfulLocalFileCount)) {
      console.info("[ReplicaOpenCheck] Cloud sync blocked by entitlement; opening local project only", {
        projectId,
        projectPath,
        localFileCount,
        meaningfulLocalFileCount,
      })

      return {
        gateSyncScreen: false,
        hasConflicts: false,
        likelyLocalWipe: false,
        totalChanges: 0,
        plan: createEmptyReplicaPlan(),
        syncAccessBlocked: true,
      }
    }

    throw new Error(bootstrap.error || "Failed to bootstrap replica")
  }

  const plan = await window.electronAPI.sync.gitReplicaPlan({
    projectId,
    projectPath,
  })
  if (!plan.success) {
    if (isReplicaSyncEntitlementError(plan.error) && canOpenProjectLocally(meaningfulLocalFileCount)) {
      console.info("[ReplicaOpenCheck] Cloud sync blocked by entitlement during planning; opening local project only", {
        projectId,
        projectPath,
        localFileCount,
        meaningfulLocalFileCount,
      })

      return {
        gateSyncScreen: false,
        hasConflicts: false,
        likelyLocalWipe: false,
        totalChanges: 0,
        plan: createEmptyReplicaPlan(),
        syncAccessBlocked: true,
      }
    }

    throw new Error(plan.error || "Failed to plan replica sync")
  }

  const totalChanges =
    plan.downloads.length +
    plan.uploads.length +
    plan.localDeletes.length +
    plan.cloudDeletes.length +
    plan.conflicts.length +
    (plan.autoMerged?.length ?? 0)

  const hasConflicts = plan.conflicts.length > 0
  const likelyLocalWipe = isLikelyLocalWorkspaceWipe(plan, meaningfulLocalFileCount)
  const gateSyncScreen = hasConflicts

  if (hasConflicts) {
    console.warn("[ReplicaOpenCheck] Conflict detection triggered", {
      projectId,
      projectPath,
      conflicts: plan.conflicts.length,
      downloads: plan.downloads.length,
      uploads: plan.uploads.length,
      cloudDeletes: plan.cloudDeletes.length,
      localDeletes: plan.localDeletes.length,
      autoMerged: plan.autoMerged?.length ?? 0,
      localFileCount,
      meaningfulLocalFileCount,
      totalChanges,
    })
  }

  if (likelyLocalWipe) {
    console.warn("[ReplicaOpenCheck] Local wipe detection triggered", {
      projectId,
      projectPath,
      localFileCount,
      meaningfulLocalFileCount,
      restoreCandidates: Math.max(plan.downloads.length, plan.cloudDeletes.length),
      cloudDeletes: plan.cloudDeletes.length,
      downloads: plan.downloads.length,
      uploads: plan.uploads.length,
      localDeletes: plan.localDeletes.length,
      conflicts: plan.conflicts.length,
      autoMerged: plan.autoMerged?.length ?? 0,
      totalChanges,
    })
  }

  console.log("[ReplicaOpenCheck] Completed pre-open replica check", {
    projectId,
    gateSyncScreen,
    hasConflicts,
    likelyLocalWipe,
    localFileCount,
    meaningfulLocalFileCount,
    totalChanges,
    downloads: plan.downloads.length,
    uploads: plan.uploads.length,
    cloudDeletes: plan.cloudDeletes.length,
    localDeletes: plan.localDeletes.length,
    conflicts: plan.conflicts.length,
    autoMerged: plan.autoMerged?.length ?? 0,
  })

  return {
    // Only gate into the manual review UI for real conflicts.
    // Non-conflict sync should complete inline from the project list/card before navigation.
    gateSyncScreen,
    hasConflicts,
    likelyLocalWipe,
    totalChanges,
    plan,
    syncAccessBlocked: false,
  }
}
