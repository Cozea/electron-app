import { describe, it, expect, vi } from 'vitest';
import type { ResolveProjectWorkspaceRequest, ResolveProjectWorkspaceResult, WorkspaceCatalogSnapshot } from '@shared/workspaceTypes';
import { WorkspaceResourceManager, laneStatesEqual } from '../../apps/desktop/src/app/resources/workspaceResources';
import { WorkspaceCatalogMirror } from '../../apps/desktop/src/app/resources/workspaceCatalogMirror';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function ready(projectId = 'a', workspaceId = 'w-a', revision = 1): Extract<ResolveProjectWorkspaceResult, { status: 'ready' }> {
  return {
    status: 'ready', projectId,
    workspace: { projectId, workspaceId, workspaceRevision: revision, verificationStatus: 'verified' },
    lane: { projectId, workspaceId, laneId: 'collab' },
    runtimeIdentity: { projectId, workspaceId, workspaceRevision: revision, laneId: 'collab', runtimeSessionId: 'runtime' },
    collaborationScopeId: projectId,
  } as Extract<ResolveProjectWorkspaceResult, { status: 'ready' }>;
}
function catalog(revision = 1): WorkspaceCatalogSnapshot {
  return { revision, generatedAt: revision, entries: { a: { ...ready('a', 'w-a', revision), reason: null } } };
}
function setup() {
  const dependencies = {
    resolveProject: vi.fn(async (_request: ResolveProjectWorkspaceRequest) => ready() as ResolveProjectWorkspaceResult),
    gitStatus: vi.fn(async () => ({ success: true, isRepo: true, currentBranch: 'feature/a' })),
    ensureCatalog: vi.fn(async () => catalog()),
    hydrateBranch: vi.fn(async () => undefined),
    readBranch: vi.fn(() => null as { activeBranch: string | null } | null),
    rememberBranch: vi.fn(),
    publishGit: vi.fn(),
  };
  return { dependencies, manager: new WorkspaceResourceManager(dependencies) };
}

describe('Actual shared workspace read paths', () => {
  it('N01/N02: hover and a mounted candidate-enabled consumer join the underlying bound resolution', async () => {
    const { manager, dependencies } = setup();
    const result = deferred<ResolveProjectWorkspaceResult>();
    dependencies.resolveProject.mockReturnValueOnce(result.promise);
    const prefetch = manager.resolutionResource({ projectId: 'a' }, false).ensure('prefetch');
    const mounted = manager.resolutionResource({ projectId: 'a' }, true).ensure('navigation');
    await Promise.resolve(); await Promise.resolve();
    result.resolve(ready());
    expect(await prefetch).toEqual(ready());
    expect(await mounted).toEqual(ready());
    expect(dependencies.resolveProject).toHaveBeenCalledTimes(1);
    expect(dependencies.resolveProject.mock.calls[0]?.[0]).toMatchObject({ allowCandidateScan: false });
  });
  it('N15: hover never scans or remembers/activates a branch; a missing binding can scan once on navigation', async () => {
    const { manager, dependencies } = setup();
    const missing: ResolveProjectWorkspaceResult = { status: 'missing-binding', projectId: 'a', actions: [] };
    dependencies.resolveProject.mockResolvedValueOnce(missing).mockResolvedValueOnce(missing);
    expect(await manager.resolutionResource({ projectId: 'a' }, true).ensure('prefetch')).toEqual(missing);
    expect(dependencies.resolveProject).toHaveBeenCalledTimes(1);
    expect(dependencies.rememberBranch).not.toHaveBeenCalled();
    // Navigation forces candidate evaluation after a prefetched missing result.
    await manager.resolutionResource({ projectId: 'a' }, true).ensure('refresh');
    expect(dependencies.resolveProject.mock.calls.some(([request]) => request.allowCandidateScan)).toBe(true);
  });
  it('N16: real lane resolver holds unknown branch information instead of guessing collab', async () => {
    const { manager, dependencies } = setup();
    dependencies.gitStatus.mockResolvedValue({ success: false, isRepo: false, currentBranch: null } as never);
    const resource = manager.laneResource('a', 'w-a', 'main');
    await expect(resource.ensure('navigation')).rejects.toThrow('not known');
    expect(resource.read().status).toBe('error');
    expect(dependencies.rememberBranch).not.toHaveBeenCalled();
  });
  it('N07: two consumers of one lane have a single scheduler and share the Git read', async () => {
    const { manager, dependencies } = setup();
    const lane = manager.laneResource('a', 'w-a', 'main');
    const first = lane.acquireDemand('foreground');
    const second = lane.acquireDemand('expanded-sidebar');
    manager.start();
    expect(manager.diagnostics().timerActive).toBe(true);
    await Promise.all([lane.ensure('navigation'), lane.ensure('navigation')]);
    expect(dependencies.gitStatus).toHaveBeenCalledTimes(1);
    first();
    expect(manager.diagnostics().timerActive).toBe(true);
    second();
    expect(manager.diagnostics().timerActive).toBe(false);
    manager.stop();
  });
  it('N08: hiding pauses reconciliation and resume uses one shared refresh', async () => {
    const { manager, dependencies } = setup();
    const lane = manager.laneResource('a', 'w-a', 'main');
    const release = lane.acquireDemand('foreground');
    manager.start();
    await lane.ensure('navigation');
    manager.setVisible(false);
    manager.reconcile('refresh');
    expect(dependencies.gitStatus).toHaveBeenCalledTimes(1);
    expect(manager.diagnostics().timerActive).toBe(false);
    manager.setVisible(true);
    await lane.ensure('navigation');
    expect(manager.diagnostics().timerActive).toBe(true);
    release(); manager.stop();
  });
  it('N10: unchanged branch results preserve lane object identity despite generated timestamps', async () => {
    const { manager } = setup();
    const lane = manager.laneResource('a', 'w-a', 'main');
    const first = await lane.ensure('navigation');
    const second = await lane.ensure('refresh');
    expect(second).toBe(first);
    expect(laneStatesEqual(first, second)).toBe(true);
  });
  it('N06: expected repository and slug differences do not reuse a captured first caller request', async () => {
    const { manager, dependencies } = setup();
    await manager.resolutionResource({ projectId: 'a', projectSlug: 'one', expectedRepo: { provider: 'unknown', url: 'https://example.com/one' } }).ensure('navigation');
    await manager.resolutionResource({ projectId: 'a', projectSlug: 'two', expectedRepo: { provider: 'unknown', url: 'https://example.com/two' } }).ensure('navigation');
    expect(dependencies.resolveProject).toHaveBeenCalledTimes(2);
    expect(dependencies.resolveProject.mock.calls[1]?.[0]).toMatchObject({ projectSlug: 'two', expectedRepo: { url: 'https://example.com/two' } });
  });
  it('rejects another project returned by workspace resolution', async () => {
    const { manager, dependencies } = setup();
    dependencies.resolveProject.mockResolvedValue(ready('other'));
    await expect(manager.resolutionResource({ projectId: 'a' }).ensure('navigation')).rejects.toThrow('another project');
  });
});

describe('Shared catalog initialization', () => {
  it('one initial request and listener; a newer push wins a racing response', async () => {
    const response = deferred<WorkspaceCatalogSnapshot>();
    let push!: (snapshot: WorkspaceCatalogSnapshot) => void;
    const bridge = { getCatalogSnapshot: vi.fn(() => response.promise),
      onCatalogSnapshotChanged: vi.fn((listener: typeof push) => { push = listener; return () => undefined; }) };
    const mirror = new WorkspaceCatalogMirror(() => bridge);
    const first = mirror.ensure();
    expect(mirror.ensure()).toBe(first);
    push(catalog(2));
    response.resolve(catalog(1));
    await first;
    expect(mirror.getSnapshot()?.revision).toBe(2);
    expect(bridge.getCatalogSnapshot).toHaveBeenCalledOnce();
    expect(bridge.onCatalogSnapshotChanged).toHaveBeenCalledOnce();
    mirror.dispose();
  });
  it('failed initial read is retryable without registering another native listener', async () => {
    const bridge = { getCatalogSnapshot: vi.fn().mockRejectedValueOnce(new Error('boot not ready')).mockResolvedValueOnce(catalog()),
      onCatalogSnapshotChanged: vi.fn(() => () => undefined) };
    const mirror = new WorkspaceCatalogMirror(() => bridge);
    await expect(mirror.ensure()).rejects.toThrow('boot not ready');
    await mirror.ensure();
    expect(bridge.getCatalogSnapshot).toHaveBeenCalledTimes(2);
    expect(bridge.onCatalogSnapshotChanged).toHaveBeenCalledOnce();
    mirror.dispose();
  });
});
