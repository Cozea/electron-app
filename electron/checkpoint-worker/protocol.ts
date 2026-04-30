import type {
  GitCheckpointCaptureResult,
  GitCheckpointDeleteResult,
  GitCheckpointDiffResult,
  GitCheckpointFilePairResult,
  GitCheckpointHeadStatsResult,
  GitChangesResult,
  GitChangesListResult,
  GitChangesPatchResult,
  GitChangesScope,
} from '../gitCheckpoints'

export interface CheckpointWorkerCaptureParams {
  cwd: string
  checkpointId: string
  authorName: string
  authorEmail?: string
}

export interface CheckpointWorkerDiffParams {
  cwd: string
  fromCheckpointId?: string | null
  toCheckpointId: string
  filePath?: string
}

export interface CheckpointWorkerFilePairParams {
  cwd: string
  fromCheckpointId?: string | null
  toCheckpointId: string
  filePath: string
}

export interface CheckpointWorkerDeleteRefsParams {
  cwd: string
  checkpointIds: string[]
}

export interface CheckpointWorkerDeleteAllRefsParams {
  cwd: string
}

export interface CheckpointWorkerHeadStatsParams {
  cwd: string
  authorName?: string
}

export interface CheckpointWorkerListChangesParams {
  cwd: string
  scope: GitChangesScope
  authorName?: string
}

export interface CheckpointWorkerReadChangesPatchParams {
  cwd: string
  scope: GitChangesScope
  filePath?: string
  authorName?: string
}

export interface CheckpointWorkerReadChangesParams {
  cwd: string
  scope: GitChangesScope
  authorName?: string
}

export interface CheckpointWorkerMethodMap {
  captureCheckpoint: {
    params: CheckpointWorkerCaptureParams
    result: GitCheckpointCaptureResult
  }
  diffCheckpoints: {
    params: CheckpointWorkerDiffParams
    result: GitCheckpointDiffResult
  }
  readCheckpointFilePair: {
    params: CheckpointWorkerFilePairParams
    result: GitCheckpointFilePairResult
  }
  deleteCheckpointRefs: {
    params: CheckpointWorkerDeleteRefsParams
    result: GitCheckpointDeleteResult
  }
  deleteAllCheckpointRefs: {
    params: CheckpointWorkerDeleteAllRefsParams
    result: GitCheckpointDeleteResult
  }
  getHeadDiffStats: {
    params: CheckpointWorkerHeadStatsParams
    result: GitCheckpointHeadStatsResult
  }
  listChanges: {
    params: CheckpointWorkerListChangesParams
    result: GitChangesListResult
  }
  readChangesPatch: {
    params: CheckpointWorkerReadChangesPatchParams
    result: GitChangesPatchResult
  }
  readChanges: {
    params: CheckpointWorkerReadChangesParams
    result: GitChangesResult
  }
}

export type CheckpointWorkerMethod = keyof CheckpointWorkerMethodMap

export type CheckpointWorkerParams<TMethod extends CheckpointWorkerMethod> =
  CheckpointWorkerMethodMap[TMethod]['params']

export type CheckpointWorkerResult<TMethod extends CheckpointWorkerMethod> =
  CheckpointWorkerMethodMap[TMethod]['result']

export type CheckpointWorkerRequest = {
  [TMethod in CheckpointWorkerMethod]: {
    type: 'request'
    id: number
    method: TMethod
    params: CheckpointWorkerParams<TMethod>
  }
}[CheckpointWorkerMethod]

export interface CheckpointWorkerSuccessResponse {
  type: 'response'
  id: number
  ok: true
  result:
    | GitCheckpointCaptureResult
    | GitCheckpointDeleteResult
    | GitCheckpointDiffResult
    | GitCheckpointFilePairResult
    | GitCheckpointHeadStatsResult
    | GitChangesResult
    | GitChangesListResult
    | GitChangesPatchResult
}

export interface CheckpointWorkerErrorResponse {
  type: 'response'
  id: number
  ok: false
  error: string
}

export type CheckpointWorkerResponse =
  | CheckpointWorkerSuccessResponse
  | CheckpointWorkerErrorResponse
