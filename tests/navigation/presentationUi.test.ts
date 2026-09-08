import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkbenchPresentationStore } from '@/features/workbench/model/workbenchPresentationStore';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';

describe('Presentation UI & Retention Invariants (U01-U05, U11, U14, P07)', () => {
  beforeEach(() => {
    useWorkbenchPresentationStore.setState({
      residents: {},
      residentOrder: [],
      activeInstanceKey: null,
      activeIdentity: null,
      activationSequence: 0,
    });
  });

  it('U01 & U02: A -> Store -> A retains resident session A without recreation', () => {
    const store = useWorkbenchPresentationStore.getState();

    const identityA: ResolvedWorkbenchIdentity = {
      projectId: 'proj-A',
      workspaceId: 'ws-A',
      workspaceRevision: 1,
      laneId: 'collab',
    };

    // 1. Visit A
    store.actions.activate(identityA);
    const state1 = useWorkbenchPresentationStore.getState();
    expect(state1.residentOrder.length).toBe(1);
    expect(state1.activeIdentity?.projectId).toBe('proj-A');

    // 2. Navigate away to Store (deactivate active)
    store.actions.deactivateActive();
    const state2 = useWorkbenchPresentationStore.getState();
    expect(state2.activeIdentity).toBeNull();
    // Invariant I02: A remains resident!
    expect(state2.residentOrder.length).toBe(1);

    // 3. Return to A
    store.actions.activate(identityA);
    const state3 = useWorkbenchPresentationStore.getState();
    expect(state3.residentOrder.length).toBe(1);
    expect(state3.activeIdentity?.projectId).toBe('proj-A');
  });

  it('U03: A -> B -> A retains distinct scopes for both A and B up to resident limit', () => {
    const store = useWorkbenchPresentationStore.getState();

    const identityA: ResolvedWorkbenchIdentity = {
      projectId: 'proj-A',
      workspaceId: 'ws-A',
      workspaceRevision: 1,
      laneId: 'collab',
    };

    const identityB: ResolvedWorkbenchIdentity = {
      projectId: 'proj-B',
      workspaceId: 'ws-B',
      workspaceRevision: 1,
      laneId: 'collab',
    };

    store.actions.activate(identityA);
    store.actions.activate(identityB);

    const state = useWorkbenchPresentationStore.getState();
    expect(state.residentOrder.length).toBe(2);
    expect(state.activeIdentity?.projectId).toBe('proj-B');

    // Return to A
    store.actions.activate(identityA);
    const stateAfterReturn = useWorkbenchPresentationStore.getState();
    expect(stateAfterReturn.residentOrder.length).toBe(2);
    expect(stateAfterReturn.activeIdentity?.projectId).toBe('proj-A');
  });

  it('U11: Bounded LRU eviction evicts oldest inactive unpinned view when exceeding 3 residents', () => {
    const store = useWorkbenchPresentationStore.getState();

    const ids: ResolvedWorkbenchIdentity[] = ['A', 'B', 'C', 'D'].map((name) => ({
      projectId: `proj-${name}`,
      workspaceId: `ws-${name}`,
      workspaceRevision: 1,
      laneId: 'collab',
    }));

    // Activate A, B, C (3 residents)
    store.actions.activate(ids[0]);
    store.actions.activate(ids[1]);
    store.actions.activate(ids[2]);

    expect(useWorkbenchPresentationStore.getState().residentOrder.length).toBe(3);

    // Activating 4th resident (D) triggers eviction of oldest inactive (A)
    store.actions.activate(ids[3]);

    const stateAfterD = useWorkbenchPresentationStore.getState();
    expect(stateAfterD.residentOrder.length).toBe(3);
    expect(stateAfterD.activeIdentity?.projectId).toBe('proj-D');

    // A was evicted; B, C, D remain
    const remainingProjects = stateAfterD.residentOrder.map(
      (k) => stateAfterD.residents[k].identity.projectId
    );
    expect(remainingProjects).not.toContain('proj-A');
    expect(remainingProjects).toContain('proj-B');
    expect(remainingProjects).toContain('proj-C');
    expect(remainingProjects).toContain('proj-D');
  });
});
