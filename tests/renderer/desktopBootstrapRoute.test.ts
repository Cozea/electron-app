import { describe, expect, it } from 'vitest'

import { isDesktopBootstrapRootLocation } from '../../apps/desktop/src/app/bootstrap/desktopBootstrap'

describe('desktop bootstrap route recognition', () => {
  it('recognizes dev/router roots and the packaged file renderer root', () => {
    expect(isDesktopBootstrapRootLocation('http:', '/')).toBe(true)
    expect(isDesktopBootstrapRootLocation('http:', '/projects')).toBe(true)
    expect(isDesktopBootstrapRootLocation('file:', '/Applications/Cozea.app/Contents/Resources/app.asar/out/renderer/index.html')).toBe(true)
  })

  it('does not replace an explicit deep-link route', () => {
    expect(isDesktopBootstrapRootLocation('file:', '/projects/join/token')).toBe(false)
    expect(isDesktopBootstrapRootLocation('http:', '/settings/account')).toBe(false)
  })
})
