import { describe, expect, it } from 'vitest'

import {
  isPathInsideDirectory,
  normalizeStoragePathForComparison,
  pathsReferToSameStorageEntry,
} from '../../../apps/desktop/electron/ipc/storagePathGuard'

describe('storagePathGuard', () => {
  it('treats macOS storage paths as case-insensitive', () => {
    expect(
      isPathInsideDirectory(
        '/Users/test/developer/Cozea',
        '/Users/test/Developer/Cozea/my-project',
        'darwin',
      ),
    ).toBe(true)
  })

  it('does not allow deleting the storage root itself', () => {
    expect(
      isPathInsideDirectory(
        '/Users/test/Developer/Cozea',
        '/Users/test/Developer/Cozea',
        'darwin',
      ),
    ).toBe(false)
  })

  it('rejects sibling directories with similar names', () => {
    expect(
      isPathInsideDirectory(
        '/Users/test/Developer/Cozea',
        '/Users/test/Developer/Cozea-old/my-project',
        'darwin',
      ),
    ).toBe(false)
  })

  it('compares cached storage entries with macOS path casing rules', () => {
    expect(
      pathsReferToSameStorageEntry(
        '/Users/test/developer/Cozea/my-project',
        '/Users/test/Developer/Cozea/my-project',
        'darwin',
      ),
    ).toBe(true)
  })

  it('preserves case sensitivity for linux paths', () => {
    expect(
      normalizeStoragePathForComparison('/home/test/Cozea/my-project', 'linux'),
    ).toBe('/home/test/Cozea/my-project')
  })
})
