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

  it('keeps heavyweight terminal and browser hosts behind demand-loading gates', () => {
    const app = read('apps/desktop/src/App.tsx')
    const renderer = read('apps/desktop/src/main.tsx')
    const terminalGate = read('apps/desktop/src/features/terminal/TerminalViewHostGate.tsx')
    const browserGate = read('apps/desktop/src/features/browser/ElectronBrowserHostGate.tsx')

    expect(app).toContain('<TerminalViewHostGate />')
    expect(app).not.toContain('<TerminalViewHost />')
    expect(renderer).toContain('<ElectronBrowserHostGate />')
    expect(renderer).not.toContain('<ElectronBrowserHost />')
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

  it('uses pre-React desktop bootstrap as the normal restore path', () => {
    const bootstrap = read('apps/desktop/src/app/bootstrap/desktopBootstrap.ts')
    const launch = read('apps/desktop/src/features/projects/pages/ProjectsLaunchPage.tsx')

    expect(bootstrap).toContain('applyDesktopBootstrapRoute')
    expect(bootstrap).toContain('/workbench')
    expect(launch).toContain('const shouldUseLegacyRestore = !featureFlags.desktopBootstrap')
    expect(launch).toContain('api.projects.getAccessibleById')
  })

  it('registers application lifetime before loading the main module', () => {
    const source = read('apps/desktop/electron/mainEntry.ts')
    expect(source.trim().split('\n')).toEqual([
      "import './registerAppLifecycle'",
      "import './desktopBootstrapMain'",
      "import './main'",
    ])
  })
})
