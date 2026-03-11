import { describe, expect, it } from 'vitest'

import { hasYjsWritebackScopeChanged } from '../src/hooks/yjsWritebackScope'

describe('Yjs writeback hydration scope', () => {
  it('resets hydration when the project changes', () => {
    expect(
      hasYjsWritebackScopeChanged(
        {
          projectId: 'project_a',
          projectPath: '/tmp/project-a',
          yjsDoc: { id: 'doc-a' },
        },
        {
          projectId: 'project_b',
          projectPath: '/tmp/project-b',
          yjsDoc: { id: 'doc-b' },
        }
      )
    ).toBe(true)
  })

  it('resets hydration when the Yjs doc instance changes for the same project', () => {
    const previousDoc = { id: 'doc-a' }
    const nextDoc = { id: 'doc-b' }

    expect(
      hasYjsWritebackScopeChanged(
        {
          projectId: 'project_a',
          projectPath: '/tmp/project-a',
          yjsDoc: previousDoc,
        },
        {
          projectId: 'project_a',
          projectPath: '/tmp/project-a',
          yjsDoc: nextDoc,
        }
      )
    ).toBe(true)
  })

  it('keeps hydration sticky only within the same scope', () => {
    const doc = { id: 'doc-a' }

    expect(
      hasYjsWritebackScopeChanged(
        {
          projectId: 'project_a',
          projectPath: '/tmp/project-a',
          yjsDoc: doc,
        },
        {
          projectId: 'project_a',
          projectPath: '/tmp/project-a',
          yjsDoc: doc,
        }
      )
    ).toBe(false)
  })
})
