import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for the workspaceId-vs-path bug: detectPackageManager /
// checkDependenciesInstalled receive an opaque catalog workspace id and must resolve it to a real
// filesystem path before performing path-based reads. Before the fix they fed the opaque id
// straight to fs:readDir, so detection silently always returned 'npm' / "not installed".

const resolveRoot = vi.fn<(workspaceId: string) => Promise<string | null>>()
const readDir = vi.fn<(path: string) => Promise<Array<{ name: string; type: string }>>>()
const readAbsoluteFile = vi.fn<(path: string) => Promise<string | null>>()

vi.mock('@/lib/projectAnalysis/projectAnalysisDesktopClient', () => ({
  projectAnalysisDesktopClient: {
    resolveRoot: (workspaceId: string) => resolveRoot(workspaceId),
    readDir: (path: string) => readDir(path),
    readAbsoluteFile: (path: string) => readAbsoluteFile(path),
    readFile: vi.fn(async () => ({ success: false })),
    listFiles: vi.fn(async () => ({ success: false })),
  },
}))

vi.mock('@/lib/settings/settingsDesktopClient', () => ({
  settingsDesktopClient: {
    get: vi.fn(async () => ({ projectsDirectory: '/projects', approvedExternalReadRoots: ['/repo'] })),
  },
}))

import { checkDependenciesInstalled, detectPackageManager } from '@/utils/projectDetector'

const WORKSPACE_ID = 'lws_3f2a1b00-0000-4000-8000-000000000000'

beforeEach(() => {
  resolveRoot.mockReset()
  readDir.mockReset()
  readAbsoluteFile.mockReset()
  readAbsoluteFile.mockResolvedValue(null)
})

describe('detectPackageManager (workspace id resolution)', () => {
  it('resolves the opaque workspace id to a path and detects pnpm from the lockfile', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([
      { name: 'package.json', type: 'file' },
      { name: 'pnpm-lock.yaml', type: 'file' },
    ])

    const pm = await detectPackageManager(WORKSPACE_ID)

    expect(resolveRoot).toHaveBeenCalledWith(WORKSPACE_ID)
    // readDir must be called with the RESOLVED path, never the opaque id.
    expect(readDir).toHaveBeenCalledWith('/repo')
    expect(readDir).not.toHaveBeenCalledWith(WORKSPACE_ID)
    expect(pm).toBe('pnpm')
  })

  it('detects bun and yarn from their lockfiles', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'bun.lock', type: 'file' }])
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('bun')

    readDir.mockResolvedValue([{ name: 'yarn.lock', type: 'file' }])
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('yarn')
  })

  it('falls back to npm when the workspace id cannot be resolved (instead of misreading the id as a path)', async () => {
    resolveRoot.mockResolvedValue(null)
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('npm')
    expect(readDir).not.toHaveBeenCalled()
  })
})

describe('checkDependenciesInstalled (workspace id resolution)', () => {
  it('reports installed when node_modules exists at the resolved root', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'node_modules', type: 'directory' }])

    const installed = await checkDependenciesInstalled(WORKSPACE_ID, 'pnpm')

    expect(readDir).toHaveBeenCalledWith('/repo')
    expect(installed).toBe(true)
  })

  it('reports not-installed (does not silently force install) when the id cannot be resolved', async () => {
    resolveRoot.mockResolvedValue(null)
    expect(await checkDependenciesInstalled(WORKSPACE_ID, 'pnpm')).toBe(false)
    expect(readDir).not.toHaveBeenCalled()
  })
})
