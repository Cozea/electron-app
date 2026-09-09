import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn<
  (options: { workspaceId: string; filePath: string }) => Promise<{
    success: boolean
    content?: string
  }>
>()
const listDirectory = vi.fn(async () => ({ success: true, entries: [] as never[] }))
const listFiles = vi.fn(async () => ({ success: false }))
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

import { detectFramework } from '@/utils/projectDetector'

const WORKSPACE_ID = 'lws_7c1d4e00-0000-4000-8000-000000000000'

function packageJson(deps: Record<string, string>): string {
  return JSON.stringify({
    name: 'sites-project',
    scripts: { dev: 'vinext dev', build: 'vinext build' },
    dependencies: deps,
    devDependencies: {
      vite: '8.0.13',
      '@vitejs/plugin-react': '6.0.2',
    },
  })
}

beforeEach(() => {
  readFile.mockReset()
  listDirectory.mockReset()
  listFiles.mockReset()
  listDirectory.mockResolvedValue({ success: true, entries: [] })
  listFiles.mockResolvedValue({ success: false })
})

describe('detectFramework for vinext projects', () => {
  // A Codex "sites" scaffold depends on vinext, never on next. Detection used to
  // fall through to the generic vite branch and hand the dev server Vite's 5173,
  // while `vinext dev` binds 3000 and ignores PORT. The readiness probe then
  // watched a port nothing would ever listen on.
  it('treats a vinext dependency as Next.js on port 3000', async () => {
    readFile.mockResolvedValue({
      success: true,
      content: packageJson({
        vinext: '1.0.0-beta.5',
        react: '19.2.6',
        'react-dom': '19.2.6',
      }),
    })

    const info = await detectFramework(WORKSPACE_ID)

    expect(info.framework).toBe('nextjs')
    expect(info.devPort).toBe(3000)
  })

  it('still reports a plain Vite React app as vite-react on 5173', async () => {
    readFile.mockResolvedValue({
      success: true,
      content: packageJson({ react: '19.2.6', 'react-dom': '19.2.6' }),
    })

    const info = await detectFramework(WORKSPACE_ID)

    expect(info.framework).toBe('vite-react')
    expect(info.devPort).toBe(5173)
  })

  it('prefers a real next dependency over the vinext branch', async () => {
    readFile.mockResolvedValue({
      success: true,
      content: packageJson({ next: '15.0.0', react: '19.2.6' }),
    })

    expect((await detectFramework(WORKSPACE_ID)).framework).toBe('nextjs')
  })
})
