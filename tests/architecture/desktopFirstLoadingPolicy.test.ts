import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('desktop-first loading architecture', () => {
  it('does not reintroduce a nested visible workbench code-loading boundary', () => {
    const source = read('apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx')
    expect(source).not.toContain('lazy(')
    expect(source).not.toContain('Loading workbench')
    expect(source).toContain('<ProjectWorkbenchSurface />')
  })

  it('keeps heavyweight terminal and browser hosts behind demand-loading gates and prewarms restored needs', () => {
    const app = read('apps/desktop/src/App.tsx')
    const renderer = read('apps/desktop/src/main.tsx')
    const terminalGate = read('apps/desktop/src/features/terminal/TerminalViewHostGate.tsx')
    const browserGate = read('apps/desktop/src/features/browser/ElectronBrowserHostGate.tsx')

    expect(app).toContain('<TerminalViewHostGate />')
    expect(app).not.toContain('<TerminalViewHost />')
    expect(renderer).toContain('<ElectronBrowserHostGate />')
    expect(renderer).not.toContain('<ElectronBrowserHost />')
    expect(renderer).toContain("restoredTileTypes.has('terminal') || restoredTileTypes.has('devServer')")
    expect(renderer).toContain("warmups.push(import('./features/terminal/TerminalViewHost'))")
    expect(renderer).toContain("warmups.push(import('./features/browser/ElectronBrowserHost'))")
    expect(terminalGate).toContain("import('./TerminalViewHost')")
    expect(browserGate).toContain("import('./ElectronBrowserHost')")
  })

  it('keeps project content mounted while workspace resolution is pending', () => {
    const source = read('apps/desktop/src/features/projects/layouts/ProjectLayout.tsx')
    expect(source).toContain('data-workspace-resolution="refreshing"')
    expect(source).toContain('Reconnecting workspace…')
    expect(source).not.toContain('h-5 w-5 animate-spin')
  })

  it('resolves local workspace identity from the stable route before cloud project data', () => {
    const source = read('apps/desktop/src/features/projects/layouts/ProjectLayout.tsx')
    expect(source).toContain('const workspaceProjectId = project?._id ? String(project._id) : routeProjectId ?? null')
    expect(source).toContain('featureFlags.localWorkspaceCatalog ? workspaceProjectId : null')
    expect(source).toContain('Boolean(project?._id) && activeBranch === collabBranch')
    expect(source).toContain('projectId={shouldEnableProjectRuntime ? project?._id ?? null : null}')
  })

  it('uses cached identity for shell paint without granting cached cloud authority', () => {
    const auth = read('apps/desktop/src/contexts/AuthContext.tsx')
    const session = read('apps/desktop/src/lib/deviceSession.ts')

    expect(auth).toContain('const [user, setUser] = useState<User | null>(() => bootstrapSession?.user ?? null)')
    expect(auth).toContain('const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)')
    expect(auth).toContain('const [accessToken, setAccessToken] = useState<string | null>(null)')
    expect(auth).toContain('bootstrapLocalDeviceSession({ force: true })')
    expect(session).not.toContain('seedDeviceSession')
  })

  it('uses pre-React desktop bootstrap as the normal restore path', () => {
    const bootstrap = read('apps/desktop/src/app/bootstrap/desktopBootstrap.ts')
    const launch = read('apps/desktop/src/features/projects/pages/ProjectsLaunchPage.tsx')

    expect(bootstrap).toContain('applyDesktopBootstrapRoute')
    expect(bootstrap).toContain('/workbench')
    expect(launch).toContain('const shouldUseLegacyRestore = !featureFlags.desktopBootstrap')
    expect(launch).toContain('api.projects.getAccessibleById')
  })

  it('marks process entry first and registers runtime shutdown after main bootstrap', () => {
    const source = read('apps/desktop/electron/mainEntry.ts')
    expect(source.trim().split('\n')).toEqual([
      "import './mainEntryMark'",
      "import './registerAppLifecycle'",
      "import './desktopBootstrapMain'",
      "import './main'",
      "import './runtimeQuitCleanup'",
    ])
  })

  it('preserves the macOS main shell on ordinary close but not application quit', () => {
    const lifecycle = read('apps/desktop/electron/registerAppLifecycle.ts')

    expect(lifecycle).toContain("app.on('browser-window-created'")
    expect(lifecycle).toContain("args.includes(MAIN_WINDOW_ARGUMENT)")
    expect(lifecycle).toContain('if (isApplicationQuitting() || window.isDestroyed()) return')
    expect(lifecycle).toContain('event.preventDefault()')
    expect(lifecycle).toContain('window.hide()')
    expect(lifecycle).toContain("app.on('activate'")
    expect(lifecycle).toContain('mainWindow.show()')
    expect(lifecycle).toContain('mainWindow.focus()')
  })
})
