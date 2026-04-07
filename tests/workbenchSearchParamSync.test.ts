import { describe, expect, it } from 'vitest'

import {
  buildClosedChangesSearchParams,
  deriveWorkbenchSearchParamIntent,
} from '../src/features/projects/hooks/useProjectWorkbenchSearchParamSync'

describe('workbench search param sync', () => {
  it('waits for lane activation before applying open and focus intents', () => {
    const params = new URLSearchParams({
      lane: 'lane-2',
      openTile: 'assistantChat',
      focusTile: 'tile-123',
    })

    expect(deriveWorkbenchSearchParamIntent(params, 'collab')).toEqual({
      requestedLaneId: 'lane-2',
      requestedOpenTarget: null,
      requestedFocusTileId: null,
      shouldWaitForLaneNavigation: true,
      shouldClearResolvedLane: false,
    })
  })

  it('exposes open and focus intents once the requested lane is active', () => {
    const params = new URLSearchParams({
      lane: 'lane-2',
      openTile: 'terminal',
      focusTile: 'tile-123',
    })

    expect(deriveWorkbenchSearchParamIntent(params, 'lane-2')).toEqual({
      requestedLaneId: 'lane-2',
      requestedOpenTarget: 'terminal',
      requestedFocusTileId: 'tile-123',
      shouldWaitForLaneNavigation: false,
      shouldClearResolvedLane: false,
    })
  })

  it('marks the lane param as clearable after the requested lane is resolved', () => {
    const params = new URLSearchParams({
      lane: 'collab',
    })

    expect(deriveWorkbenchSearchParamIntent(params, 'collab')).toEqual({
      requestedLaneId: 'collab',
      requestedOpenTarget: null,
      requestedFocusTileId: null,
      shouldWaitForLaneNavigation: false,
      shouldClearResolvedLane: true,
    })
  })

  it('removes only overlay-specific params when closing changes', () => {
    const params = new URLSearchParams({
      changes: '1',
      openTile: 'changes',
      userId: 'user-1',
      lane: 'collab',
      focusTile: 'tile-123',
    })

    const next = buildClosedChangesSearchParams(params)

    expect(next.get('changes')).toBeNull()
    expect(next.get('openTile')).toBeNull()
    expect(next.get('userId')).toBeNull()
    expect(next.get('lane')).toBe('collab')
    expect(next.get('focusTile')).toBe('tile-123')
  })
})
