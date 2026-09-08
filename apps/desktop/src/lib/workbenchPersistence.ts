import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';
import { buildWorkbenchScopeKey } from './workbenchScopeKey';
import { assertWorkspaceBindingCurrent, getWorkspaceBindingRevision } from './workspaceBindingState';
import type { WorkbenchProjectState } from './workbenchStore';

interface ModelAdapter {
  get(scopeKey: string): WorkbenchProjectState | null;
  install(scopeKey: string, model: WorkbenchProjectState): void;
  sanitize(model: WorkbenchProjectState): WorkbenchProjectState;
}
let adapter: ModelAdapter | null = null;
let installing = 0;
const pending = new Map<string, Promise<void>>();
const ready = new Set<string>();

export function registerWorkbenchModelAdapter(value: ModelAdapter): void {
  if (adapter && adapter !== value) throw new Error('Only one canonical workbench model adapter may be installed.');
  adapter = value;
}
export function isInstallingWorkbenchModel(): boolean { return installing > 0; }
export function isWorkbenchModelReady(projectId: string, laneId: string, workspaceId: string | null): boolean {
  if (typeof window === 'undefined') return true; // Pure Node reducer tests have no desktop persistence authority.
  return Boolean(workspaceId && ready.has(buildWorkbenchScopeKey(projectId, laneId, workspaceId)));
}

/** Hydrates only a concrete revisioned scope. Absence is confirmed before creating a new model. */
export function ensureWorkbenchModelReady(identity: ResolvedWorkbenchIdentity): Promise<void> {
  if (!adapter) return Promise.reject(new Error('The workbench model adapter has not initialized.'));
  assertWorkspaceBindingCurrent(identity);
  const scopeKey = buildWorkbenchScopeKey(identity.projectId, identity.laneId, identity.workspaceId, identity.workspaceRevision);
  if (ready.has(scopeKey)) return Promise.resolve();
  const existing = pending.get(scopeKey);
  if (existing) return existing;
  const operation = desktopPersistenceClient.hydrateNamespace('workbenchModel', [scopeKey]).then(() => {
    assertWorkspaceBindingCurrent(identity);
    const saved = desktopPersistenceClient.peekRecord<WorkbenchProjectState>('workbenchModel', scopeKey);
    if (saved) {
      const model = saved.data;
      if (model.projectId !== identity.projectId || model.laneId !== identity.laneId || model.workspaceId !== identity.workspaceId ||
          (saved.bindingRevision !== undefined && saved.bindingRevision !== identity.workspaceRevision)) {
        throw new Error('Saved workbench identity does not match its requested binding. The saved data was not overwritten.');
      }
      installing++;
      try { adapter!.install(scopeKey, { ...adapter!.sanitize(model), workspaceRevision: identity.workspaceRevision }); }
      finally { installing--; }
    }
    ready.add(scopeKey);
  });
  pending.set(scopeKey, operation);
  void operation.finally(() => { if (pending.get(scopeKey) === operation) pending.delete(scopeKey); }).catch(() => undefined);
  return operation;
}

/** Explicit project/relink operations may inspect saved neighbors, without activating their services. */
export async function hydrateWorkbenchModelsForProject(projectId: string): Promise<void> {
  if (!adapter) throw new Error('Workbench models are not initialized.');
  await desktopPersistenceClient.hydrateNamespace('workbenchModel');
  installing++;
  try {
    for (const [scopeKey, record] of desktopPersistenceClient.peekNamespace<WorkbenchProjectState>('workbenchModel')) {
      if (record.data.projectId !== projectId || adapter.get(scopeKey)) continue;
      adapter.install(scopeKey, adapter.sanitize(record.data));
    }
  } finally { installing--; }
}

export function persistChangedWorkbenchModels(
  next: Record<string, WorkbenchProjectState>, previous: Record<string, WorkbenchProjectState>,
): void {
  if (typeof window === 'undefined' || installing > 0) return;
  for (const [scopeKey, model] of Object.entries(next)) {
    if (model === previous[scopeKey]) continue;
    const bindingRevision = model.workspaceRevision ?? (model.workspaceId ? getWorkspaceBindingRevision(model.workspaceId) : null);
    if (!model.workspaceId || !bindingRevision) throw new Error('Refusing persistence of an unresolved workbench scope.');
    assertWorkspaceBindingCurrent({ projectId: model.projectId, workspaceId: model.workspaceId, workspaceRevision: bindingRevision });
    if (!desktopPersistenceClient.isHydrated('workbenchModel', scopeKey)) throw new Error('Refusing to replace workbench data before hydration.');
    // Layouts have their own granular record and capture lifecycle. The canonical
    // tile model remains immutable; no whole-collection sanitizer/JSON pass runs here.
    desktopPersistenceClient.queueDirtyRecord('workbenchModel', scopeKey, { ...model, layout: null }, bindingRevision);
  }
  for (const key of Object.keys(previous)) if (!next[key]) {
    void desktopPersistenceClient.deleteRecord('workbenchModel', key).catch(reportWorkbenchPersistenceError);
  }
}
export function reportWorkbenchPersistenceError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cozea:persistence-error', { detail: message }));
}
export function flushWorkbenchStorage(): Promise<void> { return desktopPersistenceClient.flush(); }
