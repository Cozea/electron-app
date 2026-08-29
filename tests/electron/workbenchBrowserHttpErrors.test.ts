import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

import {
  formatWorkbenchBrowserHttpError,
  shouldSurfaceWorkbenchBrowserHttpError,
} from '../../apps/desktop/electron/services/WorkbenchBrowserService'

describe('workbench browser HTTP errors', () => {
  it('formats the response status without inventing status text', () => {
    expect(formatWorkbenchBrowserHttpError(500, 'Internal Server Error'))
      .toBe('HTTP 500 Internal Server Error')
    expect(formatWorkbenchBrowserHttpError(502, ''))
      .toBe('HTTP 502')
  })

  it('surfaces blank HTTP error documents', () => {
    expect(shouldSurfaceWorkbenchBrowserHttpError(500, false)).toBe(true)
    expect(shouldSurfaceWorkbenchBrowserHttpError(404, false)).toBe(true)
  })

  it('preserves framework-provided error pages and successful blank pages', () => {
    expect(shouldSurfaceWorkbenchBrowserHttpError(500, true)).toBe(false)
    expect(shouldSurfaceWorkbenchBrowserHttpError(204, false)).toBe(false)
    expect(shouldSurfaceWorkbenchBrowserHttpError(null, false)).toBe(false)
  })
})
