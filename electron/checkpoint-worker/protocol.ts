import type {
  GitCheckpointCaptureResult,
  GitCheckpointDeleteResult,
  GitCheckpointDiffResult,
  GitCheckpointFilePairResult,
  GitCheckpointHeadStatsResult,
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
