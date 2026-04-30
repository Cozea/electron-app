import {
  captureCheckpoint,
  deleteAllCheckpointRefs,
  deleteCheckpointRefs,
  diffCheckpoints,
  getHeadDiffStats,
  listChanges,
  readChanges,
  readChangesPatch,
  readCheckpointFilePair,
} from '../gitCheckpoints'
import type {
  CheckpointWorkerCaptureParams,
  CheckpointWorkerDeleteAllRefsParams,
  CheckpointWorkerDeleteRefsParams,
  CheckpointWorkerDiffParams,
  CheckpointWorkerFilePairParams,
  CheckpointWorkerHeadStatsParams,
  CheckpointWorkerListChangesParams,
  CheckpointWorkerReadChangesParams,
  CheckpointWorkerReadChangesPatchParams,
  CheckpointWorkerRequest,
  CheckpointWorkerResponse,
} from './protocol'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCheckpointWorkerRequest(message: unknown): message is CheckpointWorkerRequest {
  return (
    isRecord(message) &&
    message.type === 'request' &&
    typeof message.id === 'number' &&
    (
      message.method === 'captureCheckpoint' ||
      message.method === 'diffCheckpoints' ||
      message.method === 'readCheckpointFilePair' ||
      message.method === 'deleteCheckpointRefs' ||
      message.method === 'deleteAllCheckpointRefs' ||
      message.method === 'getHeadDiffStats' ||
      message.method === 'listChanges' ||
      message.method === 'readChangesPatch' ||
      message.method === 'readChanges'
    ) &&
    isRecord(message.params)
  )
}

function sendResponse(response: CheckpointWorkerResponse): void {
  if (process.send) {
    process.send(response)
  }
}

async function handleRequest(request: CheckpointWorkerRequest): Promise<CheckpointWorkerResponse> {
  try {
    switch (request.method) {
      case 'captureCheckpoint': {
        const params = request.params as CheckpointWorkerCaptureParams
        const result = await captureCheckpoint(
          params.cwd,
          params.checkpointId,
          params.authorName,
          params.authorEmail,
        )
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'diffCheckpoints': {
        const result = await diffCheckpoints(request.params as CheckpointWorkerDiffParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'readCheckpointFilePair': {
        const result = await readCheckpointFilePair(request.params as CheckpointWorkerFilePairParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'deleteCheckpointRefs': {
        const result = await deleteCheckpointRefs(request.params as CheckpointWorkerDeleteRefsParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'deleteAllCheckpointRefs': {
        const params = request.params as CheckpointWorkerDeleteAllRefsParams
        const result = await deleteAllCheckpointRefs(params.cwd)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'getHeadDiffStats': {
        const params = request.params as CheckpointWorkerHeadStatsParams
        const result = await getHeadDiffStats(params.cwd, params.authorName)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'listChanges': {
        const result = await listChanges(request.params as CheckpointWorkerListChangesParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'readChangesPatch': {
        const result = await readChangesPatch(request.params as CheckpointWorkerReadChangesPatchParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'readChanges': {
        const result = await readChanges(request.params as CheckpointWorkerReadChangesParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
    }
  } catch (error) {
    return {
      type: 'response',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Checkpoint worker request failed.',
    }
  }
}

process.on('message', (message: unknown) => {
  if (!isCheckpointWorkerRequest(message)) {
    return
  }

  void handleRequest(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Checkpoint worker request failed.',
      })
    })
})

process.on('disconnect', () => {
  process.exit(0)
})
