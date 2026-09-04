import { describe, expect, it } from 'vitest'

import {
  shouldPreventWholeGroupDrag,
  shouldSuppressNoOpSelfDropOverlay,
} from '@/features/workbench/model/workbenchDropOverlay'

const panelDrag = {
  viewId: 'workbench',
  groupId: 'group-1',
  panelId: 'assistant-1',
}

function shouldSuppress(
  overrides: Partial<Parameters<typeof shouldSuppressNoOpSelfDropOverlay>[0]> = {},
): boolean {
  return shouldSuppressNoOpSelfDropOverlay({
    dragData: panelDrag,
    targetViewId: 'workbench',
    targetGroupId: 'group-1',
    targetPanelCount: 1,
    kind: 'content',
    position: 'center',
    ...overrides,
  })
}

describe('workbench drop overlay', () => {
  it('permits whole-group dragging only when the group contains multiple panels', () => {
    expect(shouldPreventWholeGroupDrag(0)).toBe(true)
    expect(shouldPreventWholeGroupDrag(1)).toBe(true)
    expect(shouldPreventWholeGroupDrag(2)).toBe(false)
  })

  it('suppresses the center overlay over the panel being dragged', () => {
    expect(shouldSuppress()).toBe(true)
  })

  it('suppresses every self edge for a single-panel group', () => {
    expect(shouldSuppress({ position: 'left' })).toBe(true)
  })

  it('suppresses the self center but preserves edge splitting in a multi-panel group', () => {
    expect(shouldSuppress({ targetPanelCount: 2 })).toBe(true)
    expect(shouldSuppress({ targetPanelCount: 2, position: 'right' })).toBe(false)
  })

  it('suppresses every self edge when the entire group is being dragged', () => {
    expect(
      shouldSuppress({
        dragData: { ...panelDrag, panelId: null },
        targetPanelCount: 2,
        position: 'bottom',
      }),
    ).toBe(true)
  })

  it('preserves a same-group edge target for a dragged tab group', () => {
    expect(
      shouldSuppress({
        dragData: { ...panelDrag, panelId: null, tabGroupId: 'tab-group-1' },
        targetPanelCount: 2,
        position: 'top',
      }),
    ).toBe(false)
  })

  it('preserves targets in another group or Dockview instance', () => {
    expect(shouldSuppress({ targetGroupId: 'group-2' })).toBe(false)
    expect(shouldSuppress({ targetViewId: 'another-workbench' })).toBe(false)
  })

  it('does not interfere with tab-strip reorder targets', () => {
    expect(shouldSuppress({ kind: 'tab' })).toBe(false)
    expect(shouldSuppress({ kind: 'header_space' })).toBe(false)
  })
})
