import {
  type WorkbenchRuntimeRequest,
  type WorkbenchRuntimeResponse,
  type WorkbenchRuntimeTerminalCreateParams,
  type WorkbenchRuntimeTerminalAttachViewParams,
  type WorkbenchRuntimeTerminalDetachViewParams,
  type WorkbenchRuntimeTerminalInfoParams,
  type WorkbenchRuntimeTerminalInputParams,
  type WorkbenchRuntimeTerminalKillParams,
  type WorkbenchRuntimeTerminalListParams,
  type WorkbenchRuntimeTerminalResizeParams,
  type WorkbenchRuntimeTerminalSetActivityTrackingParams,
  type WorkbenchRuntimeTerminalSnapshotParams,
} from './protocol'
import { TerminalRuntimeHost } from './terminalHost'

const host = new TerminalRuntimeHost()

host.on('event', (message) => {
  if (process.send) {
    process.send(message)
  }
})

async function handleRequest(request: WorkbenchRuntimeRequest): Promise<WorkbenchRuntimeResponse> {
  try {
    switch (request.method) {
      case 'terminal.create': {
        const result = await host.createTerminal(request.params as WorkbenchRuntimeTerminalCreateParams)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'terminal.input': {
        const params = request.params as WorkbenchRuntimeTerminalInputParams
        const result = await host.sendInput(params.terminalId, params.data)
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result,
        }
      }
      case 'terminal.attachView': {
        const params = request.params as WorkbenchRuntimeTerminalAttachViewParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.attachTerminalView(params.terminalId, params.cols, params.rows),
        }
      }
      case 'terminal.detachView': {
        const params = request.params as WorkbenchRuntimeTerminalDetachViewParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.detachTerminalView(params.terminalId),
        }
      }
      case 'terminal.resize': {
        const params = request.params as WorkbenchRuntimeTerminalResizeParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.resizeTerminal(params.terminalId, params.cols, params.rows),
        }
      }
      case 'terminal.kill': {
        const params = request.params as WorkbenchRuntimeTerminalKillParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: { success: host.killTerminal(params.terminalId) },
        }
      }
      case 'terminal.getProfiles':
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.getProfiles(),
        }
      case 'terminal.list': {
        const params = request.params as WorkbenchRuntimeTerminalListParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.listTerminalIds(params.projectPath),
        }
      }
      case 'terminal.getInfo': {
        const params = request.params as WorkbenchRuntimeTerminalInfoParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.getInfo(params.terminalId),
        }
      }
      case 'terminal.getSnapshot': {
        const params = request.params as WorkbenchRuntimeTerminalSnapshotParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: host.getTerminalSnapshot(params.terminalId),
        }
      }
      case 'terminal.setActivityTracking': {
        const params = request.params as WorkbenchRuntimeTerminalSetActivityTrackingParams
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: { success: host.setActivityTracking(params.terminalId, params.mode) },
        }
      }
      case 'terminal.killAll':
        host.killAll()
        return {
          type: 'response',
          id: request.id,
          ok: true,
          result: { success: true },
        }
      default:
        return {
          type: 'response',
          id: request.id,
          ok: false,
          error: `Unsupported workbench runtime method: ${String(request.method)}`,
        }
    }
  } catch (error) {
    return {
      type: 'response',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Workbench runtime request failed.',
    }
  }
}

process.on('message', (value: unknown) => {
  const request = value as WorkbenchRuntimeRequest | undefined
  if (!request || request.type !== 'request') {
    return
  }

  void handleRequest(request).then((response) => {
    if (process.send) {
      process.send(response)
    }
  })
})

function shutdown(): void {
  host.killAll()
  process.exit(0)
}

process.on('disconnect', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
