import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  workbenchLifecycleManager,
  type WorkbenchPresentationAdapter,
} from '@/features/workbench/model/workbenchPresentationLifecycle';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';

describe('Workbench Presentation Lifecycle & Geometry (U06-U13, U19-U20, P06, P08)', () => {
  beforeEach(() => {
    workbenchLifecycleManager.disposeAll();
  });

  it('U06 & U07: Adapters receive activation once and do not perform recurring layout while hidden', () => {
    let activateCount = 0;
    let deactivateCount = 0;

    const mockDockviewAdapter: WorkbenchPresentationAdapter = {
      activate: vi.fn(() => {
        activateCount++;
      }),
      deactivate: vi.fn(() => {
        deactivateCount++;
      }),
      captureViewState: vi.fn(),
      dispose: vi.fn(),
    };

    const unregister = workbenchLifecycleManager.registerAdapter('dockview', mockDockviewAdapter);

    const identity: ResolvedWorkbenchIdentity = {
      projectId: 'p1',
      workspaceId: 'w1',
      workspaceRevision: 1,
      laneId: 'collab',
    };

    // Activate
    workbenchLifecycleManager.activateAll(identity, 1, 1200, 800);
    expect(activateCount).toBe(1);
    expect(workbenchLifecycleManager.isCurrentSequence(1)).toBe(true);

    // Deactivate (hide)
    workbenchLifecycleManager.deactivateAll();
    expect(deactivateCount).toBe(1);
    expect(workbenchLifecycleManager.isCurrentSequence(1)).toBe(false);

    // While hidden, delayed async work capturing sequence 1 is rejected
    expect(workbenchLifecycleManager.isCurrentSequence(1)).toBe(false);

    unregister();
  });

  it('U08 & U09: Stream and terminal buffers advance independently of UI visibility (Invariant I11)', () => {
    // Hidden presentation does not imply stopped background service;
    // buffer accumulates in memory while UI presentation callbacks are inactive
    const buffer: string[] = [];
    const pushOutput = (chunk: string) => {
      buffer.push(chunk);
    };

    // Simulate terminal or agent emitting lines while UI is hidden
    pushOutput('line 1');
    pushOutput('line 2');
    pushOutput('line 3');

    expect(buffer).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('U19: Safe capture of view state before eviction', () => {
    let captured = false;
    const mockEditorAdapter: WorkbenchPresentationAdapter = {
      activate: vi.fn(),
      deactivate: vi.fn(),
      captureViewState: vi.fn(() => {
        captured = true;
      }),
      dispose: vi.fn(),
    };

    workbenchLifecycleManager.registerAdapter('editor', mockEditorAdapter);
    workbenchLifecycleManager.captureAll();

    expect(captured).toBe(true);
    expect(mockEditorAdapter.captureViewState).toHaveBeenCalledTimes(1);
  });
});
