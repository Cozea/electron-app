import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceIdentityKey,
  normalizeWorkspaceProjectPath,
} from '../../apps/desktop/src/features/workspace/workspaceIdentity'

describe('workspace identity normalization', () => {
  it('treats workspace ids as opaque values instead of filesystem paths', () => {
    expect(normalizeWorkspaceProjectPath(' workspace\\id/with/trailing/ ')).toBe(
      'workspace\\id/with/trailing/',
    )
  })

  it('builds lane identity keys from the opaque workspace id', () => {
    expect(
      buildWorkspaceIdentityKey(
        'project-123',
        'workspace\\id/with/trailing/',
        'feature',
        3,
      ),
    ).toBe('project-123::feature::workspace\\id/with/trailing/::v3')
  })
})