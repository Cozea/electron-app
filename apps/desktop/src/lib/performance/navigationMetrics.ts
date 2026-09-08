/**
 * Navigation Performance Tracing & Metrics Instrumentation
 * 
 * Conforms to Section 12 of docs/perf/navigation-runtime-plan.md:
 * - Structured bounded trace records (Section 12.1)
 * - Fine-grained counters across shell, widgets, hidden activity, resources, main IPC, and persistence (Section 12.2)
 * - Safe read-only diagnostic snapshot export without exposing sensitive URLs, tokens, or queries.
 */

export type NavigationPhaseMark =
  | 'nav:input'
  | 'nav:requested'
  | 'nav:ack-commit'
  | 'nav:route-accepted'
  | 'nav:scope-ready'
  | 'nav:model-ready'
  | 'nav:surface-commit'
  | 'nav:content-ready'
  | 'nav:native-surface-ready'
  | 'nav:presentation-ack'
  | 'nav:frame-opportunity'
  | 'nav:superseded'
  | 'nav:error';

export interface NavigationTraceRecord {
  navigationId: number;
  sourceKind: string;
  destinationKind: string;
  classification: 'resident-warm' | 'data-warm-view-cold' | 'code-cold' | 'identity-cold' | 'startup' | 'unknown';
  startedAt: number;
  marks: Partial<Record<NavigationPhaseMark, number>>;
  durationMs?: number;
  status: 'pending' | 'content-ready' | 'superseded' | 'error';
  errorMessage?: string;
}

export interface NavigationCounters {
  // Shell / presentation
  shellMounts: number;
  hostMounts: number;
  residentDescriptors: number;
  visibleSessions: number;
  ordinaryEvictions: number;
  pins: number;

  // Widgets
  dockviewCreations: number;
  dockviewDisposals: number;
  terminalInstanceCreations: number;
  terminalInstanceDisposals: number;
  viewAttachments: number;
  viewDetachments: number;
  editorCreations: number;
  editorDisposals: number;

  // Hidden activity
  hiddenLayoutCalls: number;
  hiddenTerminalFitCalls: number;
  hiddenDomMeasurements: number;
  hiddenAnimationTicks: number;
  hiddenNativeVisibilityWrites: number;

  // Resources
  underlyingResolveCalls: number;
  underlyingGitStatusCalls: number;
  dedupedJoins: number;
  invalidations: number;
  activeDemandCount: number;
  pollerCount: number;
  staleResultDiscards: number;

  // Main commands
  presentationRequests: number;
  presentationApplies: number;
  presentationSuperseded: number;
  sessionEnsures: number;
  closeKillStopCalls: number;
  presentationLeases: number;

  // Persistence
  dirtyRecordCount: number;
  rendererDispatchMs: number;
  rendererDispatchBytes: number;
  workerSerializeMs: number;
  workerWriteMs: number;
  commitRevisions: number;
  persistenceFailures: number;
  legacyAccesses: number;

  // UI Work
  longTasks: number;
  reactCommits: number;
}

const MAX_TRACES = 250;

class NavigationMetricsCollector {
  private traces: NavigationTraceRecord[] = [];
  private currentNavigationId: number = 0;
  private counters: NavigationCounters = this.createEmptyCounters();

  private createEmptyCounters(): NavigationCounters {
    return {
      shellMounts: 0,
      hostMounts: 0,
      residentDescriptors: 0,
      visibleSessions: 0,
      ordinaryEvictions: 0,
      pins: 0,

      dockviewCreations: 0,
      dockviewDisposals: 0,
      terminalInstanceCreations: 0,
      terminalInstanceDisposals: 0,
      viewAttachments: 0,
      viewDetachments: 0,
      editorCreations: 0,
      editorDisposals: 0,

      hiddenLayoutCalls: 0,
      hiddenTerminalFitCalls: 0,
      hiddenDomMeasurements: 0,
      hiddenAnimationTicks: 0,
      hiddenNativeVisibilityWrites: 0,

      underlyingResolveCalls: 0,
      underlyingGitStatusCalls: 0,
      dedupedJoins: 0,
      invalidations: 0,
      activeDemandCount: 0,
      pollerCount: 0,
      staleResultDiscards: 0,

      presentationRequests: 0,
      presentationApplies: 0,
      presentationSuperseded: 0,
      sessionEnsures: 0,
      closeKillStopCalls: 0,
      presentationLeases: 0,

      dirtyRecordCount: 0,
      rendererDispatchMs: 0,
      rendererDispatchBytes: 0,
      workerSerializeMs: 0,
      workerWriteMs: 0,
      commitRevisions: 0,
      persistenceFailures: 0,
      legacyAccesses: 0,

      longTasks: 0,
      reactCommits: 0,
    };
  }

  nextNavigationId(): number {
    return ++this.currentNavigationId;
  }

  startTrace(
    navigationId: number,
    sourceKind: string,
    destinationKind: string,
    classification: NavigationTraceRecord['classification'] = 'unknown'
  ): NavigationTraceRecord {
    const record: NavigationTraceRecord = {
      navigationId,
      sourceKind,
      destinationKind,
      classification,
      startedAt: performance.now(),
      marks: { 'nav:input': performance.now() },
      status: 'pending',
    };
    if (this.traces.length >= MAX_TRACES) {
      this.traces.shift();
    }
    this.traces.push(record);
    return record;
  }

  mark(navigationId: number, markName: NavigationPhaseMark): void {
    const trace = this.traces.find((t) => t.navigationId === navigationId);
    if (!trace) return;
    trace.marks[markName] = performance.now();

    if (markName === 'nav:content-ready') {
      trace.status = 'content-ready';
      trace.durationMs = performance.now() - trace.startedAt;
    } else if (markName === 'nav:superseded') {
      trace.status = 'superseded';
      trace.durationMs = performance.now() - trace.startedAt;
    } else if (markName === 'nav:error') {
      trace.status = 'error';
      trace.durationMs = performance.now() - trace.startedAt;
    }
  }

  increment<K extends keyof NavigationCounters>(counter: K, amount: number = 1): void {
    this.counters[counter] += amount;
  }

  setGauge<K extends keyof NavigationCounters>(gauge: K, value: number): void {
    this.counters[gauge] = value;
  }

  getSnapshot(): {
    counters: Readonly<NavigationCounters>;
    traces: readonly NavigationTraceRecord[];
    latestTrace: NavigationTraceRecord | null;
  } {
    return {
      counters: { ...this.counters },
      traces: [...this.traces],
      latestTrace: this.traces[this.traces.length - 1] ?? null,
    };
  }

  reset(): void {
    this.counters = this.createEmptyCounters();
    this.traces = [];
  }
}

export const navigationMetrics = new NavigationMetricsCollector();

// Attach diagnostic interface to global window for test harnesses in dev/test builds
if (typeof window !== 'undefined') {
  (window as unknown as { __COZEA_NAV_METRICS__?: typeof navigationMetrics }).__COZEA_NAV_METRICS__ = navigationMetrics;
}
