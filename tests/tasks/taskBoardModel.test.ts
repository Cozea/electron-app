import { describe, expect, it } from 'vitest'

import {
  normalizeManualTaskClaimants,
  normalizeManualTaskMarkers,
  inferBoardStatusFromMarkers,
  createStoredContextAttachment,
} from '@/features/tasks/model/taskBoardModel'

describe('task board model', () => {
  it('normalizes legacy markers and retains stable existing IDs', () => {
    expect(normalizeManualTaskMarkers([' First ', { id: 'stable', label: ' Second ' }, null]))
      .toEqual([{ id: 'marker-0', label: 'First' }, { id: 'stable', label: 'Second' }])
    expect(normalizeManualTaskMarkers([]).map((marker) => marker.id))
      .toEqual(['scope', 'build', 'review'])
  })

  it('deduplicates claimants by normalized identity', () => {
    const result = normalizeManualTaskClaimants([
      { id: 'first', name: ' First ', identityKey: ' CZD_TEST ' },
      { id: 'second', name: 'Second', identityKey: 'czd_test' },
      null,
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'first', name: 'First', identityKey: 'czd_test' })
  })

  it('derives completion from checked markers', () => {
    expect(inferBoardStatusFromMarkers([])).toBe('planned')
    expect(inferBoardStatusFromMarkers([{ checked: false }])).toBe('planned')
    expect(inferBoardStatusFromMarkers([{ checked: true }, { checked: false }])).toBe('active')
    expect(inferBoardStatusFromMarkers([{ checked: true }])).toBe('done')
  })

  it('preserves saved page labels and encodes their route', () => {
    expect(createStoredContextAttachment({ kind: 'page', value: '/a?b=1', label: 'Saved', title: 'Page' }, '/pages'))
      .toEqual({ kind: 'page', value: '/a?b=1', label: 'Saved', title: 'Page', href: '/pages?route=%2Fa%3Fb%3D1' })
  })
})
