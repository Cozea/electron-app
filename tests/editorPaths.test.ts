import { describe, expect, it } from 'vitest'

import {
  isAbsoluteEditorPath,
  joinProjectFilePath,
  normalizeEditorPath,
  resolveProjectFilePath,
} from '../src/lib/editor/editorPaths'

describe('editor path helpers', () => {
  it('normalizes slashes and trailing separators', () => {
    expect(normalizeEditorPath('C:\\repo\\src\\App.tsx\\')).toBe('C:/repo/src/App.tsx')
    expect(normalizeEditorPath('/repo/src/App.tsx///')).toBe('/repo/src/App.tsx')
  })

  it('detects absolute paths', () => {
    expect(isAbsoluteEditorPath('/repo/src/App.tsx')).toBe(true)
    expect(isAbsoluteEditorPath('C:/repo/src/App.tsx')).toBe(true)
    expect(isAbsoluteEditorPath('src/App.tsx')).toBe(false)
  })

  it('joins project-relative paths', () => {
    expect(joinProjectFilePath('/repo/project', 'src/App.tsx')).toBe('/repo/project/src/App.tsx')
    expect(joinProjectFilePath('/repo/project/', '/src/App.tsx')).toBe('/repo/project/src/App.tsx')
  })

  it('resolves a relative file path against the project root', () => {
    expect(resolveProjectFilePath('src/App.tsx', '/repo/project')).toEqual({
      canonicalPath: '/repo/project/src/App.tsx',
      relativePath: 'src/App.tsx',
    })
  })

  it('keeps an absolute file path inside the project root', () => {
    expect(resolveProjectFilePath('/repo/project/src/App.tsx', '/repo/project')).toEqual({
      canonicalPath: '/repo/project/src/App.tsx',
      relativePath: 'src/App.tsx',
    })
  })

  it('rejects absolute paths outside the project root', () => {
    expect(() => resolveProjectFilePath('/other/project/src/App.tsx', '/repo/project')).toThrow(
      'File path is outside the current project directory',
    )
  })
})
