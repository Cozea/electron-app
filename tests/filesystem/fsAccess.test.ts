import { describe, expect, it } from 'vitest'

import type { AppSettings } from '../../shared/electronApiTypes'
import {
  getApprovedReadRoots,
  isPathInsideRoot,
  isReadPathAllowed,
  rememberApprovedExternalReadRoot,
} from '../../electron/fsAccess'

const baseSettings: AppSettings = {
  projectsDirectory: '/Users/test/Developer/Cozea',
  previewHeaderCompatibilityEnabled: true,
  approvedExternalReadRoots: [],
}

describe('fsAccess', () => {
  it('treats the configured projects directory as an approved root', () => {
    expect(getApprovedReadRoots(baseSettings)).toContain('/Users/test/Developer/Cozea')
    expect(isReadPathAllowed('/Users/test/Developer/Cozea/demo/src/App.tsx', baseSettings)).toBe(true)
  })

  it('rejects reads outside approved roots', () => {
    expect(isReadPathAllowed('/Users/test/.ssh/id_rsa', baseSettings)).toBe(false)
    expect(isPathInsideRoot('/Users/test/Developer/Cozea-archive', '/Users/test/Developer/Cozea')).toBe(false)
  })

  it('remembers external roots without duplicating them', () => {
    const next = rememberApprovedExternalReadRoot(baseSettings, '/Users/test/Downloads/import-me')

    expect(next).toEqual({
      approvedExternalReadRoots: ['/Users/test/Downloads/import-me'],
    })

    const deduped = rememberApprovedExternalReadRoot(
      {
        ...baseSettings,
        approvedExternalReadRoots: ['/Users/test/Downloads/import-me'],
      },
      '/Users/test/Downloads/import-me',
    )

    expect(deduped).toEqual({
      approvedExternalReadRoots: ['/Users/test/Downloads/import-me'],
    })
  })
})
