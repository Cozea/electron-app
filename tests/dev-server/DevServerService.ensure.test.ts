import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cozea-dev-server-service-test' },
  ipcMain: {},
}))

import {
  DevServerService,
  type DevServerStartOptions,
  type DevServerStartResult,
} from '../../apps/desktop/electron/services/DevServerService'

function options(workspaceId: string): DevServerStartOptions {
  return {
    workspaceId,
    laneId: 'collab',
    command: 'bun run dev',
    preferredPort: 5173,
    runId: `run-${workspaceId}`,
    terminalId: `terminal-${workspaceId}`,
    onOutput: () => {},
    onExit: () => {},
  }
}

describe('DevServerService.ensure', () => {
  it('returns a ready existing singleton without calling start', async () => {
    const service = new DevServerService()
    const start = vi.spyOn(service, 'start')
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    processRegistry.set(runKey, {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'existing-run',
      activePort: 5173,
      ready: true,
    })

    const result = await service.ensure(options(workspaceId))

    expect(result).toEqual({
      success: true,
      port: 5173,
      runId: 'existing-run',
      existing: true,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('coalesces concurrent ensure requests for the same workspace and lane', async () => {
    const service = new DevServerService()
    const workspaceId = `workspace-${crypto.randomUUID()}`
    let resolveStart!: (result: DevServerStartResult) => void
    const startResult = new Promise<DevServerStartResult>((resolve) => {
      resolveStart = resolve
    })
    const start = vi.spyOn(service, 'start').mockReturnValue(startResult)

    const first = service.ensure(options(workspaceId))
    const second = service.ensure(options(workspaceId))
    resolveStart({ success: true, port: 5199, runId: 'shared-run' })

    await expect(first).resolves.toMatchObject({ success: true, existing: false })
    await expect(second).resolves.toMatchObject({ success: true, existing: true })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('joins a launch already registered by another caller', async () => {
    const service = new DevServerService()
    const start = vi.spyOn(service, 'start')
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    const launching = {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'launching-run',
      activePort: null,
      ready: false,
    }
    processRegistry.set(runKey, launching)
    setTimeout(() => {
      launching.activePort = 5277
      launching.ready = true
    }, 5)

    await expect(service.ensure(options(workspaceId))).resolves.toEqual({
      success: true,
      port: 5277,
      runId: 'launching-run',
      existing: true,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('marks only the owning terminal detached while keeping the process running', () => {
    const service = new DevServerService()
    const workspaceId = `workspace-${crypto.randomUUID()}`
    const runKey = `${workspaceId}::collab`
    const processRegistry = (service as unknown as {
      processes: Map<string, Record<string, unknown>>
    }).processes
    processRegistry.set(runKey, {
      workspaceId,
      laneId: 'collab',
      runKey,
      runId: 'headless-run',
      terminalId: 'owner-terminal',
      activePort: 5173,
      ready: true,
      phase: 'running',
      terminalDetached: false,
    })

    expect(service.detachSurface(workspaceId, 'collab', 'other-terminal')).toEqual({
      success: true,
      ownsRuntime: false,
    })
    expect(service.getState(workspaceId, 'collab').headless).toBe(false)

    expect(service.detachSurface(workspaceId, 'collab', 'owner-terminal')).toEqual({
      success: true,
      ownsRuntime: true,
    })
    expect(service.getState(workspaceId, 'collab')).toMatchObject({
      running: true,
      ready: true,
      runId: 'headless-run',
      headless: true,
    })
  })
})
