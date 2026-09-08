import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('production presentation lifecycle wiring', () => {
  it('mounts the live workbench surface in the persistent projects shell', () => {
    const layout = read('apps/desktop/src/features/projects/layouts/ProjectLayout.tsx')
    const page = read('apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx')
    expect(layout).toContain('<LazyProjectWorkbenchSurface')
    expect(page).not.toContain('<ProjectWorkbenchSurface')
  })

  it('keeps hidden Dockview instances mounted while deactivating presentation', () => {
    const host = read('apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx')
    const activity = read('apps/desktop/src/features/workbench/WorkbenchActivity.tsx')
    expect(host).toContain('mode={session.instanceKey === visibleInstanceKey ? "visible" : "hidden"}')
    expect(activity).toContain('opacity: 0')
  })

  it('routes activation exclusively through sequenced presentation commands', () => {
    const lifecycle = read('apps/desktop/src/features/workbench/hooks/useWorkbenchSessionLifecycle.ts')
    const handlers = read('apps/desktop/electron/ipc/registerWorkbenchSessionHandlers.ts')
    const preload = read('apps/desktop/electron/preload.ts')
    expect(lifecycle).toContain('navigationController.setPresentation')
    expect(lifecycle).not.toContain('.activateSession(')
    expect(handlers).toContain('catalog.getActive(target.projectId)')
    expect(handlers).not.toContain('getCatalogSnapshot')
    expect(preload).not.toContain("ipcRenderer.invoke('workbenchSession:activateSession'")
  })

  it('keeps mounted workspace resolution demanded so relinks refresh immediately', () => {
    const hooks = read('apps/desktop/src/app/resources/useWorkspaceResources.ts')
    expect(hooks).toContain("resource.acquireDemand('foreground')")
  })
})
