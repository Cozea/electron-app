from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, f'Expected one anchor in {path}: {old[:70]}'
    p.write_text(s.replace(old, new, 1))

p = Path('apps/desktop/src/app/resources/keyedResource.ts')
s = p.read_text()
s = s.replace("export type DemandKind =", "export type ResourceReason = 'prefetch' | 'navigation' | 'refresh' | 'resume';\n\nexport type DemandKind =", 1)
s = s.replace('fetcher: () => Promise<T>;', 'fetcher: (reason: ResourceReason) => Promise<T>;')
s = s.replace('  private generation = 0;', '  private lastAccessedAt = Date.now();\n  private generation = 0;', 1)
s = s.replace('    this.listeners.add(listener);', '    this.lastAccessedAt = Date.now();\n    this.listeners.add(listener);', 1)
s = s.replace('    this.demandCounts[kind]++;', '    this.lastAccessedAt = Date.now();\n    this.demandCounts[kind]++;', 1)
s = s.replace('      this.listeners.delete(listener);', '      this.listeners.delete(listener);\n      this.lastAccessedAt = Date.now();', 1)
s = s.replace('      this.demandCounts[kind] = Math.max(0, this.demandCounts[kind] - 1);', '      this.demandCounts[kind] = Math.max(0, this.demandCounts[kind] - 1);\n      this.lastAccessedAt = Date.now();', 1)
s = s.replace("  async ensure(reason: 'prefetch' | 'navigation' | 'refresh' | 'resume'): Promise<T> {\n    const now = Date.now();", """  get idle(): boolean {
    return this.inflight === null && this.listeners.size === 0 && Object.values(this.demandCounts).every(count => count === 0);
  }

  get lastAccessTime(): number { return this.lastAccessedAt; }

  touch(): void { this.lastAccessedAt = Date.now(); }

  /** Seed an unused handle from an already validated in-memory catalog entry. */
  prime(data: T): void {
    if (this.snapshot.status !== 'empty' || this.inflight) return;
    this.lastSuccessfulReadAt = Date.now();
    this.snapshot = { status: 'ready', generation: this.generation, data, refreshing: false, error: null };
    this.notify();
  }

  ensure(reason: ResourceReason): Promise<T> {
    const now = Date.now();
    this.lastAccessedAt = now;""")
s = s.replace('      return this.snapshot.data;\n    }\n\n    // 2.', '      return Promise.resolve(this.snapshot.data);\n    }\n\n    // 2.', 1)
s = s.replace('    this.inflightGeneration = requestGen;\n\n    // Update', '''    this.inflightGeneration = requestGen;
    // Publish the shared promise BEFORE notifying subscribers or invoking a
    // fetcher. Reentrant subscribers and synchronous throws must not create a
    // second request or leave a settled request installed as in-flight.
    let resolveRequest!: (value: T) => void;
    let rejectRequest!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    this.inflight = promise;

    // Update''', 1)
s = s.replace('    const promise = (async () => {', '    const perform = async () => {', 1)
s = s.replace('const result = await this.fetcher();', 'const result = await this.fetcher(reason);', 1)
s = s.replace('    })();\n\n    this.inflight = promise;\n    return promise;', '    };\n    void perform().then(resolveRequest, rejectRequest);\n    return promise;', 1)
p.write_text(s)

p = Path('apps/desktop/src/app/resources/workspaceCatalogResource.ts')
assert not p.exists()
p.write_text('''import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes'

interface CatalogAPI {
  getCatalogSnapshot(): Promise<WorkspaceCatalogSnapshot>
  onCatalogSnapshotChanged(listener: (snapshot: WorkspaceCatalogSnapshot) => void): () => void
}

type Observer = (next: WorkspaceCatalogSnapshot, previous: WorkspaceCatalogSnapshot | null) => void

/** One push-first, retryable catalog mirror shared by hover, routes and sidebar. */
export class WorkspaceCatalogResource {
  private readonly getAPI: () => CatalogAPI | undefined
  private snapshot: WorkspaceCatalogSnapshot | null = null
  private initialFetch: Promise<WorkspaceCatalogSnapshot> | null = null
  private initialFetchDone = false
  private unsubscribePush: (() => void) | null = null
  private listeners = new Set<() => void>()
  private observers = new Set<Observer>()

  constructor(getAPI: () => CatalogAPI | undefined = () => typeof window === 'undefined' ? undefined : window.electronAPI?.workspace) {
    this.getAPI = getAPI
  }

  read = (): WorkspaceCatalogSnapshot | null => this.snapshot

  observe(observer: Observer): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    void this.ensure().catch(error => console.warn('[WorkspaceCatalog] Read failed; a later demand can retry', error))
    return () => { this.listeners.delete(listener) }
  }

  ensure(): Promise<WorkspaceCatalogSnapshot> {
    if (this.initialFetchDone && this.snapshot) return Promise.resolve(this.snapshot)
    if (this.initialFetch) return this.initialFetch
    const api = this.getAPI()
    if (!api?.getCatalogSnapshot || !api.onCatalogSnapshotChanged) return Promise.reject(new Error('Workspace catalog API unavailable'))
    // The listener is in place before any initial response can arrive.
    if (!this.unsubscribePush) this.unsubscribePush = api.onCatalogSnapshotChanged(next => this.apply(next))
    const attempt = Promise.resolve().then(() => api.getCatalogSnapshot()).then(next => {
      this.apply(next)
      this.initialFetchDone = true
      return this.snapshot!
    })
    this.initialFetch = attempt
    void attempt.then(
      () => { if (this.initialFetch === attempt) this.initialFetch = null },
      () => { if (this.initialFetch === attempt) this.initialFetch = null },
    )
    return attempt
  }

  private apply(next: WorkspaceCatalogSnapshot): void {
    const previous = this.snapshot
    if (previous && next.revision <= previous.revision) return
    const entries: Record<string, WorkspaceCatalogSnapshotEntry> = {}
    for (const [key, entry] of Object.entries(next.entries)) {
      const old = previous?.entries[key]
      entries[key] = old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry
    }
    this.snapshot = { ...next, entries }
    for (const observer of this.observers) observer(this.snapshot, previous)
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.unsubscribePush?.()
    this.unsubscribePush = null
    this.listeners.clear()
    this.observers.clear()
  }
}

export const workspaceCatalogResource = new WorkspaceCatalogResource()
''')

Path('apps/desktop/src/features/workspace/useWorkspaceCatalogSnapshot.ts').write_text('''import { useSyncExternalStore } from 'react'
import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes'
import { workspaceCatalogResource } from '@/app/resources/workspaceCatalogResource'

export function useWorkspaceSnapshotEntry(projectId: string | null | undefined): WorkspaceCatalogSnapshotEntry | null {
  return useSyncExternalStore(
    workspaceCatalogResource.subscribe,
    () => projectId ? workspaceCatalogResource.read()?.entries[projectId] ?? null : null,
    () => null,
  )
}

export function useWorkspaceCatalogSnapshot(): WorkspaceCatalogSnapshot | null {
  return useSyncExternalStore(workspaceCatalogResource.subscribe, workspaceCatalogResource.read, () => null)
}
''')

p = Path('apps/desktop/src/app/resources/workspaceResources.ts')
s = p.read_text()
s = s.replace("import { KeyedResource } from './keyedResource';", "import { KeyedResource } from './keyedResource';\nimport { workspaceCatalogResource } from './workspaceCatalogResource';", 1)
s = s.replace('  RepoIdentity,\n', '  RepoIdentity,\n  WorkspaceCatalogSnapshotEntry,\n', 1)
s = s.replace('// 1. Workspace Resolution Resources', '''type ResourceMetadata = { projectId?: string; workspaceId?: string | null };
const resourceMetadata = new Map<string, ResourceMetadata>();
const MAX_IDLE_ENTRIES = 128;
const MAX_IDLE_AGE_MS = 10 * 60_000;

function repoKey(repo: RepoIdentity | null | undefined): string | null {
  if (!repo) return null;
  return JSON.stringify([repo.provider, repo.url, 'fullName' in repo ? repo.fullName : null, 'projectId' in repo ? repo.projectId : null]);
}

function catalogResolution(projectId: string, preferredWorkspaceId?: string | null, expectedRepo?: RepoIdentity | null): ResolveProjectWorkspaceResult | null {
  const entry = workspaceCatalogResource.read()?.entries[projectId];
  if (!entry || entry.status !== 'ready' || entry.workspace.verificationStatus !== 'verified' || !entry.lane || !entry.runtimeIdentity) return null;
  if (preferredWorkspaceId && entry.workspace.workspaceId !== preferredWorkspaceId) return null;
  if (expectedRepo && repoKey(expectedRepo) !== repoKey(entry.workspace.gitRepoIdentity)) return null;
  if (entry.lane.workspaceId !== entry.workspace.workspaceId || entry.runtimeIdentity.workspaceRevision !== entry.workspace.workspaceRevision) return null;
  return { status: 'ready', projectId, workspace: entry.workspace, lane: entry.lane, runtimeIdentity: entry.runtimeIdentity, collaborationScopeId: entry.collaborationScopeId };
}

/** Speculation can only read the shared catalog. Never call resolveProject here:
 * that legacy endpoint can create a default lane and write verification/events. */
export async function prefetchWorkspaceResolution(projectId: string, preferredWorkspaceId?: string | null, projectSlug?: string | null): Promise<ResolveProjectWorkspaceResult | null> {
  await workspaceCatalogResource.ensure().catch(() => null);
  const result = catalogResolution(projectId, preferredWorkspaceId);
  if (result) {
    for (const allowScan of [false, true]) {
      getWorkspaceResolutionResource(projectId, preferredWorkspaceId, projectSlug, null, allowScan).prime(result);
    }
  }
  return result;
}

// 1. Workspace Resolution Resources''', 1)
s = s.replace('    preferredWorkspaceId: preferredWorkspaceId ?? null,\n  });', '''    preferredWorkspaceId: preferredWorkspaceId ?? null,
    projectSlug: projectSlug ?? null,
    expectedRepo: repoKey(expectedRepo),
    allowCandidateScan,
  });''', 1)
s = s.replace("        const req: ResolveProjectWorkspaceRequest = {", """        await workspaceCatalogResource.ensure().catch(() => null);
        const cached = catalogResolution(projectId, preferredWorkspaceId, expectedRepo);
        if (cached) return cached;
        const req: ResolveProjectWorkspaceRequest = {""", 1)
s = s.replace('    resolutionResources.set(key, resource);\n  }\n  return resource;', '''    resolutionResources.set(key, resource);
    resourceMetadata.set(key, { projectId, workspaceId: preferredWorkspaceId });
    const cached = catalogResolution(projectId, preferredWorkspaceId, expectedRepo);
    if (cached) resource.prime(cached);
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;''', 1)
s = s.replace('if (key.includes(projectId)) {', 'if (resourceMetadata.get(key)?.projectId === projectId) {')
s = s.replace('  currentBranch?: string | null;', '  currentBranch?: string | null;\n  isRepo?: boolean;', 1)
s = s.replace('    gitStatusResources.set(key, resource);\n  }\n  return resource;', '''    gitStatusResources.set(key, resource);
    resourceMetadata.set(key, { workspaceId });
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;''', 1)
s = s.replace('      fetcher: async () => {\n        const storedSession', '      fetcher: async (reason) => {\n        if (!normalizedWorkspaceId) return null;\n        const storedSession', 1)
s = s.replace("getGitStatusResource(normalizedWorkspaceId).ensure('refresh')", "getGitStatusResource(normalizedWorkspaceId).ensure(reason)", 1)
s = s.replace('            activeBranch = storedSession?.activeBranch ?? normalizedCollabBranch;', '            return null; // No fresh or previously verified branch knowledge.', 1)
s = s.replace('          activeBranch = storedSession?.activeBranch ?? normalizedCollabBranch;', '          return null;', 1)
s = s.replace('    laneResources.set(key, resource);\n  }\n  return resource;', '''    laneResources.set(key, resource);
    resourceMetadata.set(key, { projectId, workspaceId: normalizedWorkspaceId });
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;''', 1)
s = s.replace('let isWindowVisible = true;', "let isWindowVisible = typeof document === 'undefined' || !document.hidden;", 1)
s = s.replace("  if (!isWindowVisible && reason !== 'resume') return;", "  if (!isWindowVisible) return;\n  pruneIdleWorkspaceResources();", 1)
s = s.replace('// Start shared timer automatically\nstartReconciliationScheduler();', '''function bindingStamp(entry: WorkspaceCatalogSnapshotEntry | undefined): string {
  return JSON.stringify(entry ? [entry.status, entry.workspace.workspaceId, entry.workspace.workspaceRevision, entry.workspace.verificationStatus, entry.workspace.projectRootPath, entry.workspace.gitRootPath, entry.lane?.laneId ?? null] : null);
}

// No I/O during module import. The first actual catalog demand initializes it.
workspaceCatalogResource.observe((next, previous) => {
  const projectIds = new Set([...Object.keys(next.entries), ...Object.keys(previous?.entries ?? {})]);
  for (const projectId of projectIds) {
    const old = previous?.entries[projectId];
    const entry = next.entries[projectId];
    if (bindingStamp(old) === bindingStamp(entry)) continue;
    invalidateProjectWorkspaceResolution(projectId);
    invalidateProjectLaneState(projectId);
    const ids = new Set([old?.workspace.workspaceId, entry?.workspace.workspaceId]);
    for (const [key, resource] of gitStatusResources) {
      if (ids.has(resourceMetadata.get(key)?.workspaceId ?? undefined)) resource.invalidate('catalog binding changed');
    }
  }
});

/** Evict only undemanded, unsubscribed, settled handles; never interrupt a read. */
export function pruneIdleWorkspaceResources(now = Date.now()): void {
  const maps = [resolutionResources, gitStatusResources, laneResources] as const;
  const idle = maps.flatMap(map => Array.from(map.values()).filter(resource => resource.idle));
  idle.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
  let count = idle.length;
  for (const resource of idle) {
    if (count <= MAX_IDLE_ENTRIES && now - resource.lastAccessTime < MAX_IDLE_AGE_MS) continue;
    for (const map of maps) map.delete(resource.key);
    resourceMetadata.delete(resource.key);
    count--;
  }
}

// Only a browser runtime needs this timer. A shared demand starts it in the hook.
''', 1)
p.write_text(s)

p = Path('apps/desktop/src/features/workspace/useProjectWorkspaceResolution.ts')
s = p.read_text().replace('  getWorkspaceResolutionResource,', '  prefetchWorkspaceResolution,', 1)
start = s.index('  const resource = getWorkspaceResolutionResource(')
end = s.index('\n}', start)
s = s[:start] + '''  return prefetchWorkspaceResolution(input.projectId, input.preferredWorkspaceId, input.projectSlug)''' + s[end:]
p.write_text(s)

p = Path('apps/desktop/src/app/resources/useWorkspaceResources.ts')
s = p.read_text()
s = s.replace('  getProjectLaneResource,', '  getProjectLaneResource,\n  startReconciliationScheduler,', 1)
# Source formatting is checked explicitly before replacing.
if 'startReconciliationScheduler,' not in s:
    raise AssertionError('Shared resource imports changed')
s = s.replace("resource.acquireDemand('foreground')", "(startReconciliationScheduler(), resource.acquireDemand('foreground'))")
p.write_text(s)

p = Path('tests/navigation/resourceSafety.test.ts')
assert not p.exists()
p.write_text('''import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyedResource } from '../../apps/desktop/src/app/resources/keyedResource'
import { WorkspaceCatalogResource } from '../../apps/desktop/src/app/resources/workspaceCatalogResource'
import type { WorkspaceCatalogSnapshot } from '../../shared/workspaceTypes'

const snapshot = (revision: number): WorkspaceCatalogSnapshot => ({ revision, generatedAt: revision, entries: {} })

describe('resource safety', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns the identical pending promise to every consumer', async () => {
    let finish!: (value: number) => void
    const fetcher = vi.fn(() => new Promise<number>(resolve => { finish = resolve }))
    const resource = new KeyedResource({ key: 'one', fetcher })
    const first = resource.ensure('prefetch')
    const second = resource.ensure('navigation')
    expect(second).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(42)
    await expect(first).resolves.toBe(42)
  })

  it('can retry a synchronously throwing transport', async () => {
    const fetcher = vi.fn<() => Promise<number>>().mockImplementationOnce(() => { throw new Error('sync failure') }).mockResolvedValue(7)
    const resource = new KeyedResource({ key: 'sync', fetcher })
    await expect(resource.ensure('navigation')).rejects.toThrow('sync failure')
    await expect(resource.ensure('navigation')).resolves.toBe(7)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate a request when a loading subscriber reenters ensure', async () => {
    const fetcher = vi.fn(async () => 8)
    const resource = new KeyedResource({ key: 'reentrant', fetcher })
    let joined: Promise<number> | undefined
    const unsubscribe = resource.subscribe(() => {
      if (resource.read().status === 'loading') joined = resource.ensure('navigation')
    })
    const request = resource.ensure('prefetch')
    expect(joined).toBe(request)
    await request
    expect(fetcher).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('attaches one push listener, shares bootstrap, and rejects an older initial snapshot', async () => {
    let push!: (next: WorkspaceCatalogSnapshot) => void
    let finish!: (next: WorkspaceCatalogSnapshot) => void
    const api = {
      onCatalogSnapshotChanged: vi.fn((listener: typeof push) => { push = listener; return vi.fn() }),
      getCatalogSnapshot: vi.fn(() => new Promise<WorkspaceCatalogSnapshot>(resolve => { finish = resolve })),
    }
    const catalog = new WorkspaceCatalogResource(() => api)
    const first = catalog.ensure()
    expect(catalog.ensure()).toBe(first)
    expect(api.onCatalogSnapshotChanged).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    push(snapshot(4))
    finish(snapshot(2))
    await expect(first).resolves.toMatchObject({ revision: 4 })
    expect(api.getCatalogSnapshot).toHaveBeenCalledTimes(1)
    catalog.dispose()
  })

  it('retries failed catalog initialization without leaking push listeners', async () => {
    const api = {
      onCatalogSnapshotChanged: vi.fn(() => vi.fn()),
      getCatalogSnapshot: vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(snapshot(5)),
    }
    const catalog = new WorkspaceCatalogResource(() => api)
    await expect(catalog.ensure()).rejects.toThrow('not ready')
    await expect(catalog.ensure()).resolves.toMatchObject({ revision: 5 })
    expect(api.onCatalogSnapshotChanged).toHaveBeenCalledTimes(1)
    catalog.dispose()
  })
})
''')
print('Patched shared promise identity/reentrancy, push-first catalog, non-mutating hover, exact resource keys, honest unknown lanes, and idle-only pruning.')
