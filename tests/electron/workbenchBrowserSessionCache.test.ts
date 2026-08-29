import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WorkbenchBrowserService caches Electron sessions by partition key. Ephemeral
 * partitions are keyed per tile, so leaving their entries behind pins one
 * Session per browser tile ever opened, for the life of the process.
 *
 * Persistent partitions must stay cached for the opposite reason:
 * session.fromPartition() returns the same instance for a given partition, so
 * re-resolving an evicted orgDevApp entry would re-run the setup block and
 * stack another 'will-download' listener on that same session.
 */

const fromPartition = vi.hoisted(() =>
  vi.fn((key: string) => ({
    partition: key,
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn(),
  })),
)

const createWebContents = () => ({
  navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  getURL: () => '',
  getTitle: () => '',
  isLoading: () => false,
  getZoomFactor: () => 1,
  isDestroyed: () => false,
  close: vi.fn(),
  on: vi.fn(),
  setWindowOpenHandler: vi.fn(),
})

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = createWebContents()
    setBackgroundColor = vi.fn()
    setBorderRadius = vi.fn()
    setVisible = vi.fn()
    setBounds = vi.fn()
  },
  session: { fromPartition },
  shell: { openExternal: vi.fn() },
}))

import { WorkbenchBrowserService } from '../../apps/desktop/electron/services/WorkbenchBrowserService'

/** getMainWindow returns null so attachView and emitState both no-op. */
const createService = (configureOrgDevAppSession = vi.fn()) =>
  new WorkbenchBrowserService({
    getMainWindow: () => null,
    configureOrgDevAppSession,
  })

const partitionsResolved = () => fromPartition.mock.calls.map(([key]) => key)

describe('workbench browser session cache', () => {
  beforeEach(() => {
    fromPartition.mockClear()
  })

  it('releases a tile-scoped ephemeral session when its tile is destroyed', async () => {
    const service = createService()

    // No workspaceId, so buildSessionKey falls through to the ephemeral branch.
    await service.ensureTile('tile-1', { storageScope: 'workspace' })
    expect(partitionsResolved()).toEqual(['cozea-browser-ephemeral-tile-1'])

    service.destroyTile('tile-1')

    // A cached entry would satisfy this without touching Electron again.
    await service.ensureTile('tile-1', { storageScope: 'workspace' })
    expect(partitionsResolved()).toEqual([
      'cozea-browser-ephemeral-tile-1',
      'cozea-browser-ephemeral-tile-1',
    ])
  })

  it('does not accumulate sessions across many opened and closed tiles', async () => {
    const service = createService()

    for (let index = 0; index < 25; index += 1) {
      await service.ensureTile(`tile-${index}`, { storageScope: 'workspace' })
      service.destroyTile(`tile-${index}`)
    }

    // Nothing retained: reopening one tile has to resolve its partition afresh.
    fromPartition.mockClear()
    await service.ensureTile('tile-0', { storageScope: 'workspace' })
    expect(partitionsResolved()).toEqual(['cozea-browser-ephemeral-tile-0'])
  })

  it('keeps persistent sessions cached so their setup runs only once', async () => {
    const configureOrgDevAppSession = vi.fn()
    const service = createService(configureOrgDevAppSession)

    await service.ensureTile('tile-a', {
      storageScope: 'orgDevApp',
      partitionKey: 'pub1',
    })
    service.destroyTile('tile-a')
    await service.ensureTile('tile-b', {
      storageScope: 'orgDevApp',
      partitionKey: 'pub1',
    })

    // One resolve, one configure — re-running setup would stack a second
    // 'will-download' listener on the very same Electron session.
    expect(partitionsResolved()).toEqual(['persist:cozea-devapp-pub1'])
    expect(configureOrgDevAppSession).toHaveBeenCalledTimes(1)
  })

  it('keeps an ephemeral session while another tile still shares it', async () => {
    const service = createService()

    await service.ensureTile('shared', { storageScope: 'workspace' })
    await service.ensureTile('shared', { storageScope: 'workspace' })
    service.destroyTile('shared')

    expect(partitionsResolved()).toEqual(['cozea-browser-ephemeral-shared'])
  })

  it('drops every cached session on dispose', async () => {
    const service = createService()

    await service.ensureTile('tile-x', { storageScope: 'workspace', workspaceId: 'ws-1' })
    service.dispose()

    fromPartition.mockClear()
    await service.ensureTile('tile-x', { storageScope: 'workspace', workspaceId: 'ws-1' })
    expect(partitionsResolved()).toEqual(['persist:cozea-browser-workspace-ws-1'])
  })
})
