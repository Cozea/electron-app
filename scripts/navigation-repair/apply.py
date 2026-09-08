from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, f'Expected exactly one anchor in {path}'
    p.write_text(source.replace(old, new, 1))

replace('apps/desktop/src/app/resources/workspaceResources.ts',
    "      if (ids.has(resourceMetadata.get(key)?.workspaceId ?? undefined)) resource.invalidate('catalog binding changed');",
    "      const workspaceId = resourceMetadata.get(key)?.workspaceId;\n      if (workspaceId && ids.has(workspaceId)) resource.invalidate('catalog binding changed');")
replace('scripts/prepare-t3-runtime.d.mts',
    'export function patchT3ComputerUseSource(): boolean;',
    'export function patchT3ComputerUseSource(options?: { checkOnly?: boolean; sourcePath?: string }): boolean;')
p = Path('scripts/patch-computer-use-contract.d.mts')
assert not p.exists()
p.write_text('''export interface ComputerUseToolDefinition {
  name: string;
  description: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
    [keyword: string]: unknown;
  };
}
export const computerUseCatalogue: {
  tools: ComputerUseToolDefinition[];
  [key: string]: unknown;
};
export function patchComputerUseContract(source: string): { source: string; changed: boolean };
''')
p = Path('tests/navigation/workspaceResourceIntegration.test.ts')
assert not p.exists()
p.write_text('''import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolveProjectWorkspaceResult } from '../../shared/workspaceTypes'

describe('workspace resource integration', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  function setup() {
    const resolveProject = vi.fn(async (input: { projectId: string }): Promise<ResolveProjectWorkspaceResult> => ({ status: 'missing-binding', projectId: input.projectId, actions: [] }))
    const getCatalogSnapshot = vi.fn(async () => ({ revision: 1, generatedAt: 1, entries: {} }))
    const getGitStatus = vi.fn(async () => ({ success: false, error: 'offline' }))
    vi.stubGlobal('window', {
      localStorage: globalThis.localStorage,
      electronAPI: {
        workspace: { resolveProject, getCatalogSnapshot, onCatalogSnapshotChanged: vi.fn(() => vi.fn()) },
        workspaceSync: { getGitStatus },
      },
    })
    return { resolveProject, getCatalogSnapshot, getGitStatus }
  }

  it('hover reads one shared catalog and cannot open or create a workspace', async () => {
    const api = setup()
    const { prefetchProjectWorkspaceResolution } = await import('@/features/workspace/useProjectWorkspaceResolution')
    await Promise.all(Array.from({ length: 20 }, () => prefetchProjectWorkspaceResolution({ projectId: 'hover-project', allowCandidateScan: true })))
    expect(api.getCatalogSnapshot).toHaveBeenCalledTimes(1)
    expect(api.resolveProject).not.toHaveBeenCalled()
    expect(api.getGitStatus).not.toHaveBeenCalled()
  })

  it('initial catalog arrival does not supersede the navigation waiting for it', async () => {
    const api = setup()
    const { getWorkspaceResolutionResource } = await import('@/app/resources/workspaceResources')
    const resource = getWorkspaceResolutionResource('new-project')
    const first = resource.ensure('navigation')
    expect(resource.ensure('navigation')).toBe(first)
    await expect(first).resolves.toMatchObject({ status: 'missing-binding', projectId: 'new-project' })
    expect(api.resolveProject).toHaveBeenCalledTimes(1)
    expect(resource.read().status).toBe('ready')
  })

  it('does not manufacture a collab lane for a missing workspace or failed Git read', async () => {
    const api = setup()
    const { getProjectLaneResource } = await import('@/app/resources/workspaceResources')
    await expect(getProjectLaneResource('unknown-lane-project', null, 'main').ensure('navigation')).resolves.toBeNull()
    expect(api.getGitStatus).not.toHaveBeenCalled()
    await expect(getProjectLaneResource('unknown-lane-project', 'workspace-unknown-lane', 'main').ensure('navigation')).resolves.toBeNull()
    expect(api.getGitStatus).toHaveBeenCalledTimes(1)
  })

  it('keys every resolution input and invalidates only the exact project', async () => {
    setup()
    const resources = await import('@/app/resources/workspaceResources')
    const first = resources.getWorkspaceResolutionResource('project-1', 'workspace-a', 'slug', null, false)
    expect(resources.getWorkspaceResolutionResource('project-1', 'workspace-a', 'slug', null, false)).toBe(first)
    expect(resources.getWorkspaceResolutionResource('project-1', 'workspace-a', 'other', null, false)).not.toBe(first)
    expect(resources.getWorkspaceResolutionResource('project-1', 'workspace-a', 'slug', null, true)).not.toBe(first)
    expect(resources.getWorkspaceResolutionResource('project-1', 'workspace-a', 'slug', { provider: 'unknown', url: 'https://example.test/repo' }, false)).not.toBe(first)
    const neighbor = resources.getWorkspaceResolutionResource('project-10')
    first.prime({ status: 'missing-binding', projectId: 'project-1', actions: [] })
    neighbor.prime({ status: 'missing-binding', projectId: 'project-10', actions: [] })
    resources.invalidateProjectWorkspaceResolution('project-1')
    expect(first.read().status).toBe('empty')
    expect(neighbor.read().status).toBe('ready')
  })

  it('prunes only idle handles, preserving subscribed and in-flight consumers', async () => {
    setup()
    const resources = await import('@/app/resources/workspaceResources')
    const held = resources.getWorkspaceResolutionResource('held')
    const release = held.subscribe(() => {})
    const running = resources.getWorkspaceResolutionResource('running')
    const promise = running.ensure('navigation')
    for (let i = 0; i < 150; i++) resources.getWorkspaceResolutionResource(`idle-${i}`)
    resources.pruneIdleWorkspaceResources(Date.now() + 11 * 60_000)
    expect(resources.getWorkspaceResolutionResource('held')).toBe(held)
    expect(resources.getWorkspaceResolutionResource('running')).toBe(running)
    await promise
    release()
    resources.pruneIdleWorkspaceResources(Date.now() + 11 * 60_000)
    expect(resources.getWorkspaceResolutionResource('held')).not.toBe(held)
  })
})
''')
print('Fixed nullable workspace lookup and upstream declaration gaps; added adapter-level negative and concurrency tests.')
