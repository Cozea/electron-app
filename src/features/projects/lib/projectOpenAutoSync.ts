import type { GitReplicaExecuteResult } from '@shared/electronApiTypes'
import {
  runProjectOpenReplicaCheck,
  type ProjectOpenReplicaCheckResult,
} from './projectOpenReplicaCheck'

interface ExecuteVerifiedProjectOpenAutoSyncOptions {
  projectId: string
  projectPath: string
  check: ProjectOpenReplicaCheckResult
}

export interface ExecuteVerifiedProjectOpenAutoSyncResult {
  executeResult: GitReplicaExecuteResult
  nextCheck: ProjectOpenReplicaCheckResult
}

export async function executeVerifiedProjectOpenAutoSync({
  projectId,
  projectPath,
  check,
}: ExecuteVerifiedProjectOpenAutoSyncOptions): Promise<ExecuteVerifiedProjectOpenAutoSyncResult> {
  const executeResult = await window.electronAPI.sync.gitReplicaExecute({
    projectId,
    projectPath,
    sessionId: check.plan.sessionId,
  })

  if (!executeResult.success || !executeResult.applied) {
    if (executeResult.requiresConflictResolution) {
      const nextCheck = await runProjectOpenReplicaCheck({
        projectId,
        projectPath,
      })
      return { executeResult, nextCheck }
    }

    return { executeResult, nextCheck: check }
  }

  const nextCheck = await runProjectOpenReplicaCheck({
    projectId,
    projectPath,
  })

  return { executeResult, nextCheck }
}
