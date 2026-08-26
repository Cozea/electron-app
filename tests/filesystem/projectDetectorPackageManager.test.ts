import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for the workspaceId-vs-path bug: detectPackageManager /
// checkDependenciesInstalled receive an opaque catalog workspace id and must resolve it to a real
// filesystem path before performing path-based reads. Before the fix they fed the opaque id
// straight to fs:readDir, so detection silently always returned 'npm' / "not installed".

const resolveRoot = vi.fn<(workspaceId: string) => Promise<string | null>>()
const readDir = vi.fn<(path: string) => Promise<Array<{ name: string; type: string }>>>()
const readAbsoluteFile = vi.fn<(path: string) => Promise<string | null>>()
const readFile = vi.fn<
  (options: { workspaceId: string; filePath: string }) => Promise<{
    success: boolean
    content?: string
  }>
>()
const listFiles = vi.fn<
  (options: { workspaceId: string }) => Promise<{
    success: boolean
    files?: Array<{ path: string; sizeBytes: number }>
  }>
>()

vi.mock('@/lib/projectAnalysis/projectAnalysisDesktopClient', () => ({
  projectAnalysisDesktopClient: {
    resolveRoot: (workspaceId: string) => resolveRoot(workspaceId),
    readDir: (path: string) => readDir(path),
    readAbsoluteFile: (path: string) => readAbsoluteFile(path),
    readFile: (options: { workspaceId: string; filePath: string }) => readFile(options),
    listFiles: (options: { workspaceId: string }) => listFiles(options),
    getProjectCapabilities: vi.fn(async () => ({
      runtimes: [],
      devServer: { suggestions: [], requiresUserSelection: true },
      evidence: { files: [], packageScripts: {}, nativeTargets: [] },
    })),
  },
}))

vi.mock('@/lib/settings/settingsDesktopClient', () => ({
  settingsDesktopClient: {
    get: vi.fn(async () => ({ projectsDirectory: '/projects', approvedExternalReadRoots: ['/repo'] })),
  },
}))

import {
  checkDependenciesInstalled,
  detectPackageManager,
  getDevServerConfig,
  getInstallCommand,
  hasPackageJson,
} from '@/utils/projectDetector'

const WORKSPACE_ID = 'lws_3f2a1b00-0000-4000-8000-000000000000'

beforeEach(() => {
  resolveRoot.mockReset()
  readDir.mockReset()
  readAbsoluteFile.mockReset()
  readFile.mockReset()
  listFiles.mockReset()
  readAbsoluteFile.mockResolvedValue(null)
  readFile.mockResolvedValue({ success: false })
  listFiles.mockResolvedValue({ success: false })
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

describe('nested runnable package detection', () => {
  it('launches the only runnable nested package from its own directory', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockImplementation(async (path) => {
      if (path === '/repo/frontend') {
        return [
          { name: 'package-lock.json', type: 'file' },
          { name: 'node_modules', type: 'directory' },
        ]
      }
      return [{ name: 'frontend', type: 'directory' }]
    })
    listFiles.mockResolvedValue({
      success: true,
      files: [
        { path: 'frontend/package.json', sizeBytes: 256 },
        { path: 'frontend/package-lock.json', sizeBytes: 1024 },
      ],
    })
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'frontend/package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1 --port 5173' },
          dependencies: { react: '^19.0.0' },
          devDependencies: { vite: '^7.0.0' },
        }),
      }
    })

    const config = await getDevServerConfig(
      WORKSPACE_ID,
      null,
      null,
      { previewMode: 'web', nativePlatform: null },
    )

    expect(config).toMatchObject({
      command: 'npm --prefix frontend run dev',
      port: 5173,
      label: 'Vite Dev',
      requiresUserSelection: false,
      packageDirectory: 'frontend',
      commandVerified: true,
    })
    expect(await hasPackageJson(WORKSPACE_ID, 'frontend')).toBe(true)
    expect(await checkDependenciesInstalled(WORKSPACE_ID, 'npm', 'frontend')).toBe(true)
    expect(getInstallCommand('npm', 'frontend')).toBe('npm --prefix frontend install')
    expect(readDir).toHaveBeenCalledWith('/repo/frontend')
  })

  it('validates a stored nested DevApp command against its local package script', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockImplementation(async (path) => {
      if (path === '/repo/frontend') {
        return [{ name: 'package-lock.json', type: 'file' }]
      }
      return [{ name: 'frontend', type: 'directory' }]
    })
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'frontend/package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({ scripts: { dev: 'vite --port 4321' } }),
      }
    })

    const config = await getDevServerConfig(
      WORKSPACE_ID,
      'npm --prefix frontend run dev',
      5173,
    )

    expect(config).toMatchObject({
      command: 'npm --prefix frontend run dev',
      port: 4321,
      packageDirectory: 'frontend',
      requiresUserSelection: false,
      commandVerified: true,
    })
  })

  it('never accepts shell syntax from a stored DevApp command', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'package-lock.json', type: 'file' }])
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^7.0.0' },
        }),
      }
    })

    const config = await getDevServerConfig(
      WORKSPACE_ID,
      'npm run dev && touch /tmp/pwned',
      5173,
    )

    expect(config.command).toBe('npm run dev')
    expect(config.command).not.toContain('touch')
    expect(config.packageDirectory).toBeNull()
    expect(config.commandVerified).toBe(true)
  })

  it('hard fails a pinned DevApp command when the project changed package manager', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'package-lock.json', type: 'file' }])
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^7.0.0' },
        }),
      }
    })

    await expect(
      getDevServerConfig(WORKSPACE_ID, 'pnpm run dev', 5173, {
        storedCommandSource: 'devAppRelease',
      }),
    ).rejects.toThrow(/pinned to pnpm.*now uses npm.*Update DevApp/s)
  })

  it('still falls back to detection for a merely detected stored command', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'package-lock.json', type: 'file' }])
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^7.0.0' },
        }),
      }
    })

    const config = await getDevServerConfig(WORKSPACE_ID, 'pnpm run dev', 5173)

    expect(config.command).toBe('npm run dev')
    expect(config.commandVerified).toBe(true)
  })

  it('marks a framework fallback command unverified when package.json has no runnable script', async () => {
    resolveRoot.mockResolvedValue('/repo')
    readDir.mockResolvedValue([{ name: 'package-lock.json', type: 'file' }])
    readFile.mockImplementation(async ({ filePath }) => {
      if (filePath !== 'package.json') return { success: false }
      return {
        success: true,
        content: JSON.stringify({
          scripts: { build: 'vite build' },
          devDependencies: { vite: '^7.0.0' },
        }),
      }
    })

    const config = await getDevServerConfig(WORKSPACE_ID)

    expect(config.command).toMatch(/run dev$/)
    expect(config.commandVerified).toBe(false)
  })
})
