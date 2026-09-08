/**
 * Workbench Presentation Adapter & Lifecycle Protocol
 * Conforms to Section 8 of docs/perf/navigation-runtime-plan.md
 */

import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';

export interface WorkbenchPresentationAdapter {
  activate(input: {
    identity: ResolvedWorkbenchIdentity;
    activationSequence: number;
    width: number;
    height: number;
  }): void;
  deactivate(): void;
  captureViewState(): void;
  dispose(): void;
}

class WorkbenchLifecycleManager {
  private adapters = new Map<string, WorkbenchPresentationAdapter>();
  private activeSequence = 0;
  private isVisible = false;

  registerAdapter(id: string, adapter: WorkbenchPresentationAdapter): () => void {
    this.adapters.set(id, adapter);
    return () => {
      this.adapters.delete(id);
    };
  }

  activateAll(
    identity: ResolvedWorkbenchIdentity,
    sequence: number,
    width: number,
    height: number
  ): void {
    this.activeSequence = sequence;
    this.isVisible = true;

    for (const adapter of this.adapters.values()) {
      try {
        adapter.activate({ identity, activationSequence: sequence, width, height });
      } catch (err) {
        console.warn('[WorkbenchLifecycle] Adapter activation failed:', err);
      }
    }
  }

  deactivateAll(): void {
    this.isVisible = false;
    for (const adapter of this.adapters.values()) {
      try {
        adapter.deactivate();
      } catch (err) {
        console.warn('[WorkbenchLifecycle] Adapter deactivation failed:', err);
      }
    }
  }

  captureAll(): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.captureViewState();
      } catch (err) {
        console.warn('[WorkbenchLifecycle] Adapter capture failed:', err);
      }
    }
  }

  disposeAll(): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.dispose();
      } catch (err) {
        console.warn('[WorkbenchLifecycle] Adapter disposal failed:', err);
      }
    }
    this.adapters.clear();
  }

  isCurrentSequence(seq: number): boolean {
    return this.isVisible && seq === this.activeSequence;
  }
}

export const workbenchLifecycleManager = new WorkbenchLifecycleManager();
