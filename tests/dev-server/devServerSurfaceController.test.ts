import { describe, expect, it } from 'vitest'

import {
  claimDevServerSurface,
  interruptDevServerSurfaceLease,
  releaseDevServerSurfaceLease,
  renewDevServerSurfaceLease,
} from '@/features/dev-server/devServerSurfaceController'

describe('devServerSurfaceController leases', () => {
  it('reuses a surface for its owner and prevents another owner from hijacking it', () => {
    const tileId = `dev-server-${crypto.randomUUID()}`
    const first = claimDevServerSurface([tileId], 'thread-a')
    const renewed = claimDevServerSurface([tileId], 'thread-a')

    expect(first).not.toBeNull()
    expect(renewed?.token).toBe(first?.token)
    expect(claimDevServerSurface([tileId], 'thread-b')).toBeNull()
    expect(renewDevServerSurfaceLease(tileId, first!.token)).toBe(true)

    expect(releaseDevServerSurfaceLease(tileId, first!.token)).toBe(true)
    expect(claimDevServerSurface([tileId], 'thread-b')).not.toBeNull()
  })

  it('gives user interaction priority and forces an agent to choose another surface', () => {
    const interruptedTileId = `dev-server-${crypto.randomUUID()}`
    const fallbackTileId = `dev-server-${crypto.randomUUID()}`
    const first = claimDevServerSurface([interruptedTileId], 'thread-a')
    expect(first).not.toBeNull()

    interruptDevServerSurfaceLease(interruptedTileId)

    expect(renewDevServerSurfaceLease(interruptedTileId, first!.token)).toBe(false)
    expect(claimDevServerSurface([interruptedTileId, fallbackTileId], 'thread-a')?.tileId)
      .toBe(fallbackTileId)
  })
})
