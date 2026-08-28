import { beforeEach, describe, expect, it, vi } from 'vitest'

// Package detection must remain scoped to an authorized workspace id. Attached
// folders are deliberately absent from the global fs allowlist, so these tests
// fail if detection ever falls back to absolute-path fs:readDir/fs:readFile.

const listDirectory = vi.fn<
  (options: { workspaceId: string; directory?: string | null }) => Promise<{
    success: boolean
    entries?: Array<{ name: string; type: 'file' | 'directory' }>
    error?: string
  }>
>()
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
const getProjectCapabilities = vi.fn(async () => ({
  runtimes: [],
  devServer: { suggestions: [], requiresUserSelection: true },
  evidence: { files: [], scripts: [], lockfiles: [] },
}))

vi.mock('@/lib/projectAnalysis/projectAnalysisDesktopClient', () => ({
  projectAnalysisDesktopClient: {
    listDirectory: (options: { workspaceId: string; directory?: string | null }) =>
      listDirectory(options),
    readFile: (options: { workspaceId: string; filePath: string }) => readFile(options),
    listFiles: (options: { workspaceId: string }) => listFiles(options),
    getProjectCapabilities: () => getProjectCapabilities(),
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
  listDirectory.mockReset()
  readFile.mockReset()
  listFiles.mockReset()
  getProjectCapabilities.mockReset()
  listDirectory.mockResolvedValue({ success: true, entries: [] })
  readFile.mockResolvedValue({ success: false })
  listFiles.mockResolvedValue({ success: false })
  getProjectCapabilities.mockResolvedValue({
    runtimes: [],
    devServer: { suggestions: [], requiresUserSelection: true },
    evidence: { files: [], scripts: [], lockfiles: [] },
  })
})

describe('Core ML command resolution handoff', () => {
  it('uses the bounded command selected by the main-process resolver', async () => {
    getProjectCapabilities.mockResolvedValue({
      runtimes: [],
      devServer: {
        suggestions: [
          {
            command: 'python3 -m http.server {port} --bind 127.0.0.1',
            runtime: 'python',
            confidence: 0.87,
            reason: 'Found a root static HTML entry point.',
          },
        ],
        selectedCommand: 'python3 -m http.server {port} --bind 127.0.0.1',
        requiresUserSelection: false,
      },
      evidence: { files: ['index.html'], scripts: [], lockfiles: [] },
    })

    const config = await getDevServerConfig(WORKSPACE_ID, null, 4173)

    expect(config).toMatchObject({
      command: 'python3 -m http.server {port} --bind 127.0.0.1',
      port: 4173,
      requiresUserSelection: false,
      commandVerified: true,
    })
  })
})

describe('detectPackageManager (workspace-scoped inspection)', () => {
  it('detects pnpm from an attached workspace without any global path read', async () => {
    listDirectory.mockResolvedValue({
      success: true,
      entries: [
        { name: 'package.json', type: 'file' },
        { name: 'pnpm-lock.yaml', type: 'file' },
      ],
    })

    const pm = await detectPackageManager(WORKSPACE_ID)

    expect(listDirectory).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      directory: null,
    })
    expect(pm).toBe('pnpm')
  })

  it('detects bun and yarn from their lockfiles', async () => {
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'bun.lock', type: 'file' }],
    })
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('bun')

    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'yarn.lock', type: 'file' }],
    })
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('yarn')
  })

  it('falls back to npm when workspace inspection is denied', async () => {
    listDirectory.mockResolvedValue({ success: false, error: 'Workspace not found' })
    expect(await detectPackageManager(WORKSPACE_ID)).toBe('npm')
  })

  it('builds the pnpm command consumed by Dev Server and Project DevApp publishing', async () => {
    listDirectory.mockResolvedValue({
      success: true,
      entries: [
        { name: 'node_modules', type: 'directory' },
        { name: 'package.json', type: 'file' },
        { name: 'pnpm-lock.yaml', type: 'file' },
      ],
    })
    readFile.mockImplementation(async ({ filePath }) =>
      filePath === 'package.json'
        ? {
            success: true,
            content: JSON.stringify({
              scripts: { dev: 'next dev' },
              dependencies: { next: '^16.0.0' },
            }),
          }
        : { success: false },
    )

    const config = await getDevServerConfig(WORKSPACE_ID)

    expect(config).toMatchObject({
      command: 'pnpm run dev',
      packageDirectory: null,
      commandVerified: true,
    })
    await expect(checkDependenciesInstalled(WORKSPACE_ID, 'pnpm')).resolves.toBe(true)
  })
})

describe('checkDependenciesInstalled (workspace-scoped inspection)', () => {
  it('reports installed when node_modules exists in the workspace root', async () => {
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'node_modules', type: 'directory' }],
    })

    const installed = await checkDependenciesInstalled(WORKSPACE_ID, 'pnpm')

    expect(listDirectory).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      directory: null,
    })
    expect(installed).toBe(true)
  })

  it('reports not-installed when workspace inspection is denied', async () => {
    listDirectory.mockResolvedValue({ success: false, error: 'Workspace not found' })
    expect(await checkDependenciesInstalled(WORKSPACE_ID, 'pnpm')).toBe(false)
  })
})

describe('nested runnable package detection', () => {
  it('launches the only runnable nested package from its own directory', async () => {
    listDirectory.mockImplementation(async ({ directory }) => {
      if (directory === 'frontend') {
        return {
          success: true,
          entries: [
            { name: 'package-lock.json', type: 'file' },
            { name: 'node_modules', type: 'directory' },
          ],
        }
      }
      return {
        success: true,
        entries: [{ name: 'frontend', type: 'directory' }],
      }
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
    expect(listDirectory).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      directory: 'frontend',
    })
  })

  it('validates a stored nested DevApp command against its local package script', async () => {
    listDirectory.mockImplementation(async ({ directory }) => {
      if (directory === 'frontend') {
        return {
          success: true,
          entries: [{ name: 'package-lock.json', type: 'file' }],
        }
      }
      return {
        success: true,
        entries: [{ name: 'frontend', type: 'directory' }],
      }
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
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'package-lock.json', type: 'file' }],
    })
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
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'package-lock.json', type: 'file' }],
    })
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
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'package-lock.json', type: 'file' }],
    })
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
    listDirectory.mockResolvedValue({
      success: true,
      entries: [{ name: 'package-lock.json', type: 'file' }],
    })
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
