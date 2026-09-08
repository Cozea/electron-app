import { describe, it, expect, vi, afterEach } from 'vitest';
import { KeyedResource, ResourceAccessError, ResourceSupersededError } from '@/app/resources/keyedResource';
import { ResourcePool } from '@/app/resources/resourcePool';
import { buildPresentationInstanceKey, buildResourceKey, validatePresentationCommand } from '@shared/navigationRuntimeTypes';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe('Keyed resource ownership', () => {
  it('N01/N02: prefetch and consumers share the same in-flight Promise and one underlying operation', async () => {
    const response = deferred<{ id: string }>();
    const fetcher = vi.fn(() => response.promise);
    const resource = new KeyedResource({ key: 'workspace', fetcher });
    const prefetch = resource.ensure('prefetch');
    expect(resource.ensure('navigation')).toBe(prefetch);
    expect(resource.ensure('refresh')).toBe(prefetch);
    response.resolve({ id: 'workspace' });
    await prefetch;
    expect(fetcher).toHaveBeenCalledOnce();
    const snapshot = resource.read();
    expect(resource.read()).toBe(snapshot);
    expect(await resource.ensure('navigation')).toBe(snapshot.status === 'ready' ? snapshot.data : undefined);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('installs in-flight ownership before a synchronous subscriber can re-enter ensure', async () => {
    const fetcher = vi.fn(async () => 'ready');
    const resource = new KeyedResource({ key: 'reentrant', fetcher });
    let joined: Promise<string> | null = null;
    const unsubscribe = resource.subscribe(() => {
      if (resource.read().status === 'loading') joined = resource.ensure('navigation');
    });
    const first = resource.ensure('prefetch');
    expect(joined).toBe(first);
    await first;
    expect(fetcher).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it('N03: a stale completion cannot publish or clear a newer generation request', async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const resource = new KeyedResource<string>({ key: 'generation', fetcher });
    const first = resource.ensure('navigation');
    await Promise.resolve();
    resource.invalidate('binding revision changed');
    const second = resource.ensure('navigation');
    await Promise.resolve();
    old.resolve('wrong workspace');
    await expect(first).rejects.toThrow(ResourceSupersededError);
    expect(resource.ensure('prefetch')).toBe(second);
    next.resolve('correct workspace');
    expect(await second).toBe('correct workspace');
    expect(resource.read()).toMatchObject({ status: 'ready', generation: 1, data: 'correct workspace' });
  });
  it('N04: transient refresh failure retains the last successful display value', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ value: 1 }).mockRejectedValueOnce(new Error('network timeout'));
    const resource = new KeyedResource<{ value: number }>({ key: 'transient', fetcher });
    const first = await resource.ensure('navigation');
    expect(await resource.ensure('refresh')).toBe(first);
    const snapshot = resource.read();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') expect(snapshot.error?.message).toBe('network timeout');
  });
  it('N05: authoritative access failure discards stale successful data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('private state').mockRejectedValueOnce(new ResourceAccessError('access revoked'));
    const resource = new KeyedResource<string>({ key: 'authority', fetcher });
    await resource.ensure('navigation');
    await expect(resource.ensure('refresh')).rejects.toThrow('access revoked');
    expect(resource.read().status).toBe('error');
  });
  it('N05: authoritative null replaces rather than falls back to stale success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ value: 1 }).mockResolvedValueOnce(null);
    const resource = new KeyedResource<{ value: number } | null>({ key: 'deleted', fetcher });
    await resource.ensure('navigation');
    expect(await resource.ensure('refresh')).toBeNull();
    expect(resource.read()).toMatchObject({ status: 'ready', data: null });
  });
  it('N07: demand releases are idempotent and independent by consumer kind', () => {
    const resource = new KeyedResource({ key: 'demand', fetcher: async () => null });
    const foreground = resource.acquireDemand('foreground');
    const sidebar = resource.acquireDemand('expanded-sidebar');
    foreground(); foreground();
    expect(resource.getDemand('foreground')).toBe(0);
    expect(resource.getDemand('expanded-sidebar')).toBe(1);
    expect(resource.isIdle).toBe(false);
    sidebar();
    expect(resource.isIdle).toBe(true);
  });
  it('N10: equality preserves the data reference across fresh equivalent results', async () => {
    const resource = new KeyedResource({ key: 'stable', fetcher: async () => ({ value: 42 }), equalityFn: (a, b) => a.value === b.value });
    const first = await resource.ensure('navigation');
    expect(await resource.ensure('refresh')).toBe(first);
  });
  it('idle eviction never disposes a demanded, subscribed or pending resource', async () => {
    const pool = new ResourcePool<string, string>({ maxIdle: 1, idleTtlMs: 1 });
    const pending = deferred<string>();
    const a = pool.get('a', 'a', { fetcher: () => pending.promise });
    const request = a.ensure('prefetch');
    const b = pool.get('b', 'b', { fetcher: async () => 'b' });
    const release = b.acquireDemand('foreground');
    const c = pool.get('c', 'c', { fetcher: async () => 'c' });
    const unsubscribe = c.subscribe(() => undefined);
    pool.prune(Date.now() + 100_000);
    expect(pool.size).toBe(3);
    pending.resolve('a'); await request;
    release(); unsubscribe();
    pool.prune(Date.now() + 100_000);
    expect(pool.size).toBe(0);
  });
  it('disposal rejects a stale retained handle rather than recreating an unmanaged request', async () => {
    const resource = new KeyedResource({ key: 'disposed', fetcher: vi.fn(async () => 'data') });
    resource.dispose();
    await expect(resource.ensure('navigation')).rejects.toThrow(ResourceSupersededError);
  });
});

describe('Identity contracts', () => {
  it('N06: binding revision participates in instance identity and resource parameters are ordered', () => {
    const identity = { projectId: 'p', workspaceId: 'w', workspaceRevision: 1, laneId: 'collab' };
    expect(buildPresentationInstanceKey(identity)).not.toBe(buildPresentationInstanceKey({ ...identity, workspaceRevision: 2 }));
    expect(buildResourceKey('git', { b: 2, a: 1 })).toBe(buildResourceKey('git', { a: 1, b: 2 }));
  });
  it('validates wire commands rather than accepting arbitrary target objects', () => {
    const command = { clientEpoch: 'epoch', sequence: 1, navigationId: 1,
      target: { projectId: 'p', workspaceId: 'w', workspaceRevision: 1, laneId: 'collab' }, retained: [] };
    expect(validatePresentationCommand(command)).toBe(true);
    expect(validatePresentationCommand(null)).toBe(false);
    expect(validatePresentationCommand({ ...command, clientEpoch: '' })).toBe(false);
    expect(validatePresentationCommand({ ...command, sequence: -1 })).toBe(false);
    expect(validatePresentationCommand({ ...command, target: { projectId: '' } })).toBe(false);
  });
});
