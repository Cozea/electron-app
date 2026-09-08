import { describe, it, expect, beforeEach } from 'vitest';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

describe('NavigationMetricsCollector (P01 regression & instrumentation)', () => {
  beforeEach(() => {
    navigationMetrics.reset();
  });

  it('allocates monotonically increasing navigation IDs', () => {
    const id1 = navigationMetrics.nextNavigationId();
    const id2 = navigationMetrics.nextNavigationId();
    expect(id2).toBeGreaterThan(id1);
  });

  it('starts a trace and records phase marks accurately', () => {
    const navId = navigationMetrics.nextNavigationId();
    const trace = navigationMetrics.startTrace(navId, 'store', 'workbench', 'resident-warm');

    expect(trace.navigationId).toBe(navId);
    expect(trace.status).toBe('pending');
    expect(trace.marks['nav:input']).toBeDefined();

    navigationMetrics.mark(navId, 'nav:scope-ready');
    navigationMetrics.mark(navId, 'nav:content-ready');

    const snapshot = navigationMetrics.getSnapshot();
    const recorded = snapshot.traces.find((t) => t.navigationId === navId);
    expect(recorded).toBeDefined();
    expect(recorded?.status).toBe('content-ready');
    expect(recorded?.marks['nav:scope-ready']).toBeDefined();
    expect(recorded?.marks['nav:content-ready']).toBeDefined();
    expect(recorded?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('correctly increments and gauges fine-grained counters across subsystems', () => {
    navigationMetrics.increment('shellMounts');
    navigationMetrics.increment('dockviewCreations', 2);
    navigationMetrics.increment('hiddenLayoutCalls', 5);
    navigationMetrics.increment('underlyingResolveCalls');
    navigationMetrics.increment('presentationRequests');
    navigationMetrics.increment('dirtyRecordCount', 3);

    navigationMetrics.setGauge('activeDemandCount', 4);
    navigationMetrics.setGauge('residentDescriptors', 3);

    const { counters } = navigationMetrics.getSnapshot();
    expect(counters.shellMounts).toBe(1);
    expect(counters.dockviewCreations).toBe(2);
    expect(counters.hiddenLayoutCalls).toBe(5);
    expect(counters.underlyingResolveCalls).toBe(1);
    expect(counters.presentationRequests).toBe(1);
    expect(counters.dirtyRecordCount).toBe(3);
    expect(counters.activeDemandCount).toBe(4);
    expect(counters.residentDescriptors).toBe(3);
  });

  it('bounds maximum stored traces to prevent memory leak', () => {
    for (let i = 0; i < 300; i++) {
      const id = navigationMetrics.nextNavigationId();
      navigationMetrics.startTrace(id, 'a', 'b');
    }
    const snapshot = navigationMetrics.getSnapshot();
    expect(snapshot.traces.length).toBeLessThanOrEqual(250);
  });
});
