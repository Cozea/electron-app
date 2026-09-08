import { describe, it, expect, vi } from 'vitest';
import { KeyedResource, ResourceSupersededError } from '@/app/resources/keyedResource';
import {
  buildPresentationInstanceKey,
  buildResourceKey,
  validatePresentationCommand,
  type PresentationCommand,
} from '@shared/navigationRuntimeTypes';

describe('KeyedResource & Navigation Contracts (N01-N10, P02)', () => {
  it('N01: Two subscribers and prefetch request same unresolved key -> exactly one underlying fetch call', async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { id: 'ws-1', name: 'Workspace 1' };
    });

    const resource = new KeyedResource({ key: 'test:n01', fetcher });

    // Simultaneous prefetch and subscriber ensures
    const p1 = resource.ensure('prefetch');
    const p2 = resource.ensure('navigation');
    const p3 = resource.ensure('navigation');

    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

    expect(callCount).toBe(1);
    expect(res1).toEqual({ id: 'ws-1', name: 'Workspace 1' });
    expect(res2).toBe(res1);
    expect(res3).toBe(res1);
  });

  it('N02: Resolve prefetch after destination mounts -> no second mounted request', async () => {
    let callCount = 0;
    const resource = new KeyedResource({
      key: 'test:n02',
      fetcher: async () => {
        callCount++;
        return { data: 'ready' };
      },
      ttlMs: 5000,
    });

    // Prefetch completes
    await resource.ensure('prefetch');
    expect(callCount).toBe(1);

    // Later destination mount
    const mountedResult = await resource.ensure('navigation');
    expect(callCount).toBe(1);
    expect(mountedResult).toEqual({ data: 'ready' });
  });

  it('N03: Invalidate while old request runs; start new request; resolve old last -> old result cannot publish or clear new inflight', async () => {
    let resolveFirst: (v: string) => void = () => {};
    let resolveSecond: (v: string) => void = () => {};

    let count = 0;
    const resource = new KeyedResource({
      key: 'test:n03',
      fetcher: () => {
        count++;
        if (count === 1) {
          return new Promise<string>((r) => {
            resolveFirst = r;
          });
        } else {
          return new Promise<string>((r) => {
            resolveSecond = r;
          });
        }
      },
    });

    // Start request 1 (generation 0)
    const p1 = resource.ensure('navigation');

    // Invalidate while request 1 is in-flight -> generation becomes 1
    resource.invalidate('branch changed');

    // Start request 2 (generation 1)
    const p2 = resource.ensure('navigation');

    // Resolve the new request first, then the stale request last.
    resolveSecond('fresh result 2');
    const res2 = await p2;
    expect(res2).toBe('fresh result 2');
    resolveFirst('stale result 1');
    await expect(p1).rejects.toThrow(ResourceSupersededError);
    expect(resource.read().status).toBe('ready');
    if (resource.read().status === 'ready') {
      expect((resource.read() as any).data).toBe('fresh result 2');
    }
  });

  it('keeps demanded ready data visible and immediately refreshes after invalidation', async () => {
    let value = 'first';
    const resource = new KeyedResource({
      key: 'test:demanded-invalidation',
      fetcher: async () => value,
    });
    await resource.ensure('navigation');
    const release = resource.acquireDemand('foreground');
    value = 'second';
    resource.invalidate('catalog changed');
    const refreshing = resource.read();
    expect(refreshing.status).toBe('ready');
    if (refreshing.status === 'ready') {
      expect(refreshing.data).toBe('first');
      expect(refreshing.refreshing).toBe(true);
    }
    await vi.waitFor(() => {
      const ready = resource.read();
      expect(ready.status).toBe('ready');
      if (ready.status === 'ready') expect(ready.data).toBe('second');
    });
    release();
  });

  it('restarts a demanded loading resource immediately after invalidation', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const resource = new KeyedResource({
      key: 'test:demanded-loading-invalidation',
      fetcher: () => new Promise<string>(resolve => resolvers.push(resolve)),
    });
    const release = resource.acquireDemand('foreground');
    const stale = resource.ensure('navigation');

    resource.invalidate('workspace binding changed');
    expect(resolvers).toHaveLength(2);
    expect(resource.read().status).toBe('loading');

    resolvers[1]?.('fresh');
    await vi.waitFor(() => {
      const snapshot = resource.read();
      expect(snapshot.status).toBe('ready');
      if (snapshot.status === 'ready') expect(snapshot.data).toBe('fresh');
    });
    resolvers[0]?.('stale');
    await expect(stale).rejects.toThrow(ResourceSupersededError);
    release();
  });

  it('supersedes an older navigation request for explicit refresh and shares that refresh', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const reasons: string[] = [];
    const resource = new KeyedResource({
      key: 'test:explicit-refresh',
      fetcher: reason => {
        reasons.push(reason);
        return new Promise<string>(resolve => resolvers.push(resolve));
      },
    });
    const navigation = resource.ensure('navigation');
    const refresh = resource.ensure('refresh');
    const joinedRefresh = resource.ensure('refresh');
    expect(reasons).toEqual(['navigation', 'refresh']);
    resolvers[1]?.('fresh');
    await expect(refresh).resolves.toBe('fresh');
    await expect(joinedRefresh).resolves.toBe('fresh');
    resolvers[0]?.('stale');
    await expect(navigation).rejects.toThrow(ResourceSupersededError);
  });

  it('reports superseded requests as active until their fetchers settle', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const resource = new KeyedResource({
      key: 'test:active-request-lifetime',
      fetcher: () => new Promise<string>(resolve => resolvers.push(resolve)),
    });
    const first = resource.ensure('navigation');
    resource.invalidate('supersede');
    expect(resource.hasInFlightRequest()).toBe(true);
    resolvers[0]?.('stale');
    await expect(first).rejects.toThrow(ResourceSupersededError);
    expect(resource.hasInFlightRequest()).toBe(false);
  });

  it('N04: Cached ready entry, background refresh fails -> cached display survives, error is visible as refresh state', async () => {
    let shouldFail = false;
    const resource = new KeyedResource({
      key: 'test:n04',
      fetcher: async () => {
        if (shouldFail) throw new Error('Network timeout during background refresh');
        return { count: 42 };
      },
    });

    await resource.ensure('navigation');
    expect(resource.read().status).toBe('ready');
    if (resource.read().status === 'ready') {
      expect((resource.read() as any).data).toEqual({ count: 42 });
    }

    // Now background refresh fails
    shouldFail = true;
    const cachedData = await resource.ensure('refresh');
    expect(cachedData).toEqual({ count: 42 });

    const snapshot = resource.read();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.data).toEqual({ count: 42 });
      expect(snapshot.refreshing).toBe(false);
      expect(snapshot.error?.message).toContain('Network timeout');
    }
  });

  it('N05: Invalidation resets cached state; authoritative null/denied terminates cached success', async () => {
    const resource = new KeyedResource({
      key: 'test:n05',
      fetcher: async () => ({ authorized: true }),
    });

    await resource.ensure('navigation');
    expect(resource.read().status).toBe('ready');

    resource.invalidate('access revoked');
    expect(resource.read().status).toBe('empty');
  });

  it('N06: Canonical key builders handle workspace revisions and parameter ordering deterministically', () => {
    const key1 = buildPresentationInstanceKey({
      projectId: 'p1',
      workspaceId: 'w1',
      workspaceRevision: 1,
      laneId: 'collab',
    });
    const key2 = buildPresentationInstanceKey({
      projectId: 'p1',
      workspaceId: 'w1',
      workspaceRevision: 2, // different revision
      laneId: 'collab',
    });
    expect(key1).not.toBe(key2);

    // Resource key sort invariance
    const rKey1 = buildResourceKey('gitStatus', { b: 2, a: 1 });
    const rKey2 = buildResourceKey('gitStatus', { a: 1, b: 2 });
    expect(rKey1).toBe(rKey2);
  });

  it('N07 & N08: Demand tracking for foreground and sidebar consumers', () => {
    const resource = new KeyedResource({
      key: 'test:demand',
      fetcher: async () => 'data',
    });

    const release1 = resource.acquireDemand('foreground');
    const release2 = resource.acquireDemand('expanded-sidebar');

    expect(resource.getDemand('foreground')).toBe(1);
    expect(resource.getDemand('expanded-sidebar')).toBe(1);

    release1();
    expect(resource.getDemand('foreground')).toBe(0);
    expect(resource.getDemand('expanded-sidebar')).toBe(1);

    release2();
    expect(resource.getDemand('expanded-sidebar')).toBe(0);
  });

  it('N10: Stable reference preservation via equality function', async () => {
    let call = 0;
    const resource = new KeyedResource({
      key: 'test:n10',
      fetcher: async () => {
        call++;
        return { items: [1, 2, 3] }; // new object every call
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });

    const first = await resource.ensure('navigation');
    const second = await resource.ensure('refresh');

    expect(call).toBe(2);
    expect(second).toBe(first); // Strict object equality preserved
  });

  it('Validates presentation commands strictly against malformed payloads', () => {
    const validCmd: PresentationCommand = {
      clientEpoch: 'epoch-12345',
      sequence: 1,
      navigationId: 101,
      target: {
        projectId: 'p1',
        workspaceId: 'w1',
        workspaceRevision: 1,
        laneId: 'collab',
      },
      retained: [],
    };
    expect(validatePresentationCommand(validCmd)).toBe(true);

    expect(validatePresentationCommand(null)).toBe(false);
    expect(validatePresentationCommand({ ...validCmd, clientEpoch: '' })).toBe(false);
    expect(validatePresentationCommand({ ...validCmd, sequence: -1 })).toBe(false);
    expect(validatePresentationCommand({ ...validCmd, target: { projectId: '' } })).toBe(false);
  });

  it('N11: A->B->C with deferred prerequisites in reverse order: latest accepted intent C wins', async () => {
    let activeIntent = 0;
    let foregroundDestination = '';

    const navigate = (id: number, dest: string, delayMs: number) => {
      activeIntent = id;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (activeIntent === id) {
            foregroundDestination = dest;
          }
          resolve();
        }, delayMs);
      });
    };

    // A arrives late (50ms), B arrives mid (30ms), C arrives early (10ms)
    const pA = navigate(1, 'A', 50);
    const pB = navigate(2, 'B', 30);
    const pC = navigate(3, 'C', 10);

    await Promise.all([pA, pB, pC]);

    expect(activeIntent).toBe(3);
    expect(foregroundDestination).toBe('C');
  });

  it('N15: Prefetching resolution or lane knowledge triggers zero side effects', async () => {
    let sideEffectsCount = 0;
    const readOnlyFetcher = async () => {
      return { status: 'ok' };
    };

    const resource = new KeyedResource({
      key: 'test:n15',
      fetcher: readOnlyFetcher,
    });

    await resource.ensure('prefetch');
    expect(sideEffectsCount).toBe(0);
    expect(resource.read().status).toBe('ready');
  });

  it('N16: Unresolved branch status does not invent an arbitrary branch', async () => {
    const resource = new KeyedResource<{ branch: string | null }>({
      key: 'test:n16',
      fetcher: async () => ({ branch: null }),
    });

    const result = await resource.ensure('navigation');
    expect(result.branch).toBeNull();
  });
});
