import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';

interface Binding { projectId: string; workspaceId: string; workspaceRevision: number; valid: boolean }
const bindings = new Map<string, Binding>();
const listeners = new Set<() => void>();
let revision = 0;
let expectedMutation: ResolvedWorkbenchIdentity | null = null;

/** Renderer mirror only. Main still validates the catalog at the actual IPC mutation boundary. */
export function publishWorkspaceBinding(binding: Omit<Binding, 'valid'>): void {
  if (!binding.projectId || !binding.workspaceId || !Number.isSafeInteger(binding.workspaceRevision) || binding.workspaceRevision < 1) {
    throw new Error('A workspace binding requires concrete identity and a positive revision.');
  }
  const old = bindings.get(binding.workspaceId);
  if (old && old.workspaceRevision > binding.workspaceRevision) return;
  if (old?.valid && old.projectId === binding.projectId && old.workspaceRevision === binding.workspaceRevision) return;
  bindings.set(binding.workspaceId, { ...binding, valid: true });
  revision++;
  for (const listener of listeners) listener();
}
export function invalidateWorkspaceBinding(workspaceId: string): void {
  const binding = bindings.get(workspaceId);
  if (!binding || !binding.valid) return;
  bindings.set(workspaceId, { ...binding, valid: false });
  revision++;
  for (const listener of listeners) listener();
}
export function getWorkspaceBindingRevision(workspaceId: string | null | undefined): number | null {
  const binding = workspaceId ? bindings.get(workspaceId) : null;
  return binding?.valid ? binding.workspaceRevision : null;
}
export function isWorkspaceBindingCurrent(identity: Pick<ResolvedWorkbenchIdentity, 'projectId' | 'workspaceId' | 'workspaceRevision'>): boolean {
  const binding = bindings.get(identity.workspaceId);
  return Boolean(binding?.valid && binding.projectId === identity.projectId && binding.workspaceRevision === identity.workspaceRevision);
}
export function assertWorkspaceBindingCurrent(identity: Pick<ResolvedWorkbenchIdentity, 'projectId' | 'workspaceId' | 'workspaceRevision'>): void {
  if (!isWorkspaceBindingCurrent(identity)) throw new Error('The workspace binding changed. Reopen its current validated workbench before modifying state.');
}
export function getWorkspaceBindingsRevision(): number { return revision; }
export function subscribeWorkspaceBindings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A synchronous action scope captures the caller's revision across asynchronous UI continuations. */
export function withWorkbenchMutationIdentity<T>(identity: ResolvedWorkbenchIdentity, operation: () => T): T {
  assertWorkspaceBindingCurrent(identity);
  const previous = expectedMutation;
  expectedMutation = identity;
  try { return operation(); } finally { expectedMutation = previous; }
}
export function assertWorkbenchMutationIdentity(projectId: string, laneId: string, workspaceId: string): number {
  const currentRevision = getWorkspaceBindingRevision(workspaceId);
  if (!currentRevision) throw new Error('The workspace identity has not resolved.');
  assertWorkspaceBindingCurrent({ projectId, workspaceId, workspaceRevision: currentRevision });
  if (expectedMutation && (expectedMutation.projectId !== projectId || expectedMutation.workspaceId !== workspaceId ||
      expectedMutation.laneId !== laneId || expectedMutation.workspaceRevision !== currentRevision)) {
    throw new Error('A retained workbench attempted to modify another session or binding revision.');
  }
  return currentRevision;
}
