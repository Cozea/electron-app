/**
 * Wire-safe identity, presentation epoch/sequence, resource revision, and validation contracts.
 * Conforms to Section 4 of docs/perf/navigation-runtime-plan.md
 */

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

export interface ClientPresentationRegistration {
  clientEpoch: string;
  currentSnapshotRevision: number;
}

/**
 * Builds canonical presentation instance key (Section 4.1).
 * Version-prefixed JSON tuple: stable across route/display-name changes;
 * changes on binding invalidation or revision change.
 */
export function buildPresentationInstanceKey(identity: ResolvedWorkbenchIdentity): string {
  return JSON.stringify([
    'v1',
    identity.projectId,
    identity.workspaceId,
    identity.workspaceRevision,
    identity.laneId,
  ]);
}

/**
 * Builds canonical request/resource key (Section 4.1).
 */
export function buildResourceKey(kind: string, parts: Record<string, unknown>): string {
  const sortedKeys = Object.keys(parts).sort();
  const sortedEntries = sortedKeys.map((k) => [k, parts[k]]);
  return JSON.stringify([kind, sortedEntries]);
}

/**
 * Validates syntax, ranges, and types for a PresentationCommand.
 */
export function validatePresentationCommand(command: unknown): command is PresentationCommand {
  if (!command || typeof command !== 'object') return false;
  const c = command as Record<string, unknown>;
  if (typeof c.clientEpoch !== 'string' || c.clientEpoch.length === 0 || c.clientEpoch.length > 128) {
    return false;
  }
  if (typeof c.sequence !== 'number' || !Number.isSafeInteger(c.sequence) || c.sequence < 0) {
    return false;
  }
  if (typeof c.navigationId !== 'number' || !Number.isSafeInteger(c.navigationId)) {
    return false;
  }
  if (c.target !== null && !isValidWorkbenchIdentity(c.target)) {
    return false;
  }
  if (!Array.isArray(c.retained) || c.retained.length > 32) {
    return false;
  }
  for (const item of c.retained) {
    if (!isValidWorkbenchIdentity(item)) return false;
  }
  return true;
}

export function isValidWorkbenchIdentity(id: unknown): id is ResolvedWorkbenchIdentity {
  if (!id || typeof id !== 'object') return false;
  const x = id as Record<string, unknown>;
  return (
    typeof x.projectId === 'string' &&
    x.projectId.length > 0 &&
    typeof x.workspaceId === 'string' &&
    x.workspaceId.length > 0 &&
    typeof x.workspaceRevision === 'number' &&
    Number.isSafeInteger(x.workspaceRevision) &&
    typeof x.laneId === 'string' &&
    x.laneId.length > 0
  );
}
