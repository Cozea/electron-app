# Navigation Runtime Contracts (Frozen P02)

This document specifies the wire-safe and module contracts for the Cozea Navigation and Workspace-Runtime Architecture Rewrite.

---

## 1. Identity & Presentation Contracts (`shared/navigationRuntimeTypes.ts`)

```ts
export interface ResolvedWorkspaceIdentity {
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
}

export interface ResolvedWorkbenchIdentity extends ResolvedWorkspaceIdentity {
  laneId: string;
}

export interface PresentationCommand {
  clientEpoch: string;          // issued by main; bound to the sender WebContents
  sequence: number;             // increasing safe integer within that epoch
  navigationId: number;         // diagnostics/supersession only; not a persistence key
  target: ResolvedWorkbenchIdentity | null;
  retained: readonly ResolvedWorkbenchIdentity[];
}

export type PresentationCommandResult =
  | { status: 'applied'; sequence: number; sessionKey: string | null }
  | { status: 'superseded'; sequence: number }
  | { status: 'invalidated'; sequence: number; reason: string };

export function buildPresentationInstanceKey(identity: ResolvedWorkbenchIdentity): string;
export function buildResourceKey(kind: string, parts: Record<string, unknown>): string;
export function validatePresentationCommand(command: unknown): command is PresentationCommand;
```

---

## 2. Desktop State Persistence Contracts (`shared/desktopPersistenceTypes.ts`)

```ts
export type DesktopStateNamespace =
  | 'queryCache'
  | 'workbenchModel'
  | 'workbenchLayout'
  | 'lastWorkbenchRoute'
  | 'sessionRegistry';

export interface DesktopStateRecord<T = unknown> {
  schemaVersion: 1;
  namespace: DesktopStateNamespace;
  key: string;
  recordRevision: number;
  updatedAt: number;
  bindingRevision?: number;
  data: T;
}

export interface PersistenceCommitRequest {
  records: DesktopStateRecord[];
}

export interface PersistenceCommitResult {
  status: 'committed' | 'error';
  committedRevisions: Record<string, number>;
  watermark?: number;
  errorMessage?: string;
}

export interface PersistenceLoadRequest {
  namespace: DesktopStateNamespace;
  keys?: string[];
}

export interface PersistenceLoadResult {
  records: DesktopStateRecord[];
}

export interface PersistenceFlushRequest {
  targetRevision?: number;
}

export interface PersistenceFlushResult {
  status: 'flushed' | 'error';
  flushedRevision: number;
  errorMessage?: string;
}
```

---

## 3. Keyed Resource State Machine (`apps/desktop/src/app/resources/keyedResource.ts`)

```ts
export type ResourceSnapshot<T> =
  | { status: 'empty'; generation: number }
  | { status: 'loading'; generation: number }
  | {
      status: 'ready';
      generation: number;
      data: T;
      refreshing: boolean;
      error: Error | null;
    }
  | { status: 'error'; generation: number; error: Error };

export interface ResourceHandle<T> {
  read(): ResourceSnapshot<T>;
  subscribe(listener: () => void): () => void;
  ensure(reason: 'prefetch' | 'navigation' | 'refresh' | 'resume'): Promise<T>;
  invalidate(reason: string): void;
  acquireDemand(kind: 'foreground' | 'expanded-sidebar' | 'background'): () => void;
  getDemand(kind: 'foreground' | 'expanded-sidebar' | 'background'): number;
}
```
