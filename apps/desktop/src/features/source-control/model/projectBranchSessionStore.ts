import type { ProjectLaneDescriptor, ProjectLaneState } from '@shared/electronApiTypes';
import { desktopPersistenceClient } from '@/app/model/persistence/desktopPersistenceClient';

const COLLAB_LANE_ID = 'collab';
const LOCAL_LANE_PREFIX = 'branch:';
export interface StoredProjectBranchSession {
  projectId: string;
  activeBranch: string | null;
  collabBranch: string;
  workspaceId: string | null;
  updatedAt: number;
}
function normalizeBranch(value: string | null | undefined, fallback = 'main'): string { return value?.trim() || fallback; }
function buildSessionStorageKey(projectId: string, workspaceId: string): string { return `${projectId.trim()}::${workspaceId.trim()}`; }

export function ensureProjectBranchSessionReady(projectId: string, workspaceId: string): Promise<void> {
  return desktopPersistenceClient.hydrateNamespace('branchKnowledge', [buildSessionStorageKey(projectId, workspaceId)]);
}
export function readScopedProjectBranchSession(projectId: string | null | undefined, workspaceId: string | null | undefined): StoredProjectBranchSession | null {
  if (!projectId?.trim() || !workspaceId?.trim()) return null;
  return desktopPersistenceClient.peekRecord<StoredProjectBranchSession>('branchKnowledge', buildSessionStorageKey(projectId, workspaceId))?.data ?? null;
}
export function readProjectBranchSession(projectId: string | null | undefined): StoredProjectBranchSession | null {
  if (!projectId?.trim()) return null;
  let latest: StoredProjectBranchSession | null = null;
  for (const record of desktopPersistenceClient.peekNamespace<StoredProjectBranchSession>('branchKnowledge').values()) {
    if (record.data.projectId === projectId.trim() && (!latest || record.data.updatedAt > latest.updatedAt)) latest = record.data;
  }
  return latest;
}
export function rememberProjectBranchSession(args: { projectId: string; branch: string; collabBranch: string; workspaceId: string | null }): StoredProjectBranchSession {
  const projectId = args.projectId.trim();
  const workspaceId = args.workspaceId?.trim();
  if (!projectId || !workspaceId || !args.branch.trim()) throw new Error('Branch knowledge requires a concrete project, workspace and known branch.');
  const old = readScopedProjectBranchSession(projectId, workspaceId);
  const collabBranch = normalizeBranch(args.collabBranch);
  if (old?.activeBranch === args.branch.trim() && old.collabBranch === collabBranch) return old;
  const session: StoredProjectBranchSession = { projectId, workspaceId, activeBranch: args.branch.trim(), collabBranch, updatedAt: Date.now() };
  desktopPersistenceClient.queueDirtyRecord('branchKnowledge', buildSessionStorageKey(projectId, workspaceId), session);
  return session;
}
export async function clearProjectBranchSession(projectId: string | null | undefined, workspaceId?: string | null): Promise<void> {
  if (!projectId?.trim()) return;
  if (workspaceId?.trim()) {
    await desktopPersistenceClient.deleteRecord('branchKnowledge', buildSessionStorageKey(projectId, workspaceId));
    return;
  }
  await desktopPersistenceClient.hydrateNamespace('branchKnowledge');
  for (const [key, record] of desktopPersistenceClient.peekNamespace<StoredProjectBranchSession>('branchKnowledge')) {
    if (record.data.projectId === projectId.trim()) await desktopPersistenceClient.deleteRecord('branchKnowledge', key);
  }
}

export function buildBranchSessionLaneId(branch: string, collabBranch: string): string {
  return normalizeBranch(branch) === normalizeBranch(collabBranch) ? COLLAB_LANE_ID : `${LOCAL_LANE_PREFIX}${encodeURIComponent(normalizeBranch(branch, collabBranch))}`;
}
export type LaneBranchResolution = { kind: 'resolved'; branch: string; remember: boolean } | { kind: 'unresolved' };
interface GitStatusLike { success?: boolean; isRepo?: boolean; currentBranch?: string | null }

/** No fresh or previously recorded knowledge means unresolved, never an invented writable lane. */
export function resolveLaneBranchKnowledge(args: { statusResult: GitStatusLike | null | undefined; storedBranch: string | null; collabBranch: string }): LaneBranchResolution {
  const { statusResult, storedBranch, collabBranch } = args;
  const freshBranch = statusResult?.success ? statusResult.currentBranch?.trim() : null;
  if (freshBranch) return { kind: 'resolved', branch: freshBranch, remember: true };
  if (statusResult?.success && statusResult.isRepo === false) return { kind: 'resolved', branch: collabBranch, remember: false };
  if (storedBranch?.trim()) return { kind: 'resolved', branch: storedBranch.trim(), remember: false };
  // Preserve the existing deliberate handling of a positively identified repo
  // with an unborn/detached HEAD. A failed git read is NOT this case.
  if (statusResult?.success && statusResult.isRepo) return { kind: 'resolved', branch: collabBranch, remember: false };
  return { kind: 'unresolved' };
}
export function resolveBranchSessionLaneBranch(laneId: string | null | undefined, collabBranch: string): string | null {
  const normalized = laneId?.trim();
  if (!normalized) return null;
  if (normalized === COLLAB_LANE_ID) return normalizeBranch(collabBranch);
  if (!normalized.startsWith(LOCAL_LANE_PREFIX)) return null;
  const encoded = normalized.slice(LOCAL_LANE_PREFIX.length);
  if (!encoded) return null;
  try { return normalizeBranch(decodeURIComponent(encoded), collabBranch); } catch { return null; }
}
export function activateProjectBranchLane(args: { projectId: string; laneId: string; collabBranch: string; workspaceId: string | null }): StoredProjectBranchSession | null {
  if (!args.workspaceId) return null;
  const branch = resolveBranchSessionLaneBranch(args.laneId, args.collabBranch);
  return branch ? rememberProjectBranchSession({ ...args, branch }) : null;
}
export function buildProjectBranchLaneState(args: { projectId: string; workspaceId: string | null; collabBranch: string; activeBranch: string | null }): ProjectLaneState | null {
  const projectId = args.projectId.trim();
  const workspaceId = args.workspaceId?.trim();
  const activeBranch = args.activeBranch?.trim();
  if (!projectId || !workspaceId || !activeBranch) return null;
  const collabBranch = normalizeBranch(args.collabBranch);
  const now = Date.now();
  const shared: ProjectLaneDescriptor = { id: COLLAB_LANE_ID, name: 'Shared', branch: collabBranch, workspaceId,
    isCollab: true, createdAt: now, updatedAt: now };
  const lanes: ProjectLaneDescriptor[] = [shared];
  let activeLaneId = shared.id;
  if (activeBranch !== collabBranch) {
    const local: ProjectLaneDescriptor = { id: buildBranchSessionLaneId(activeBranch, collabBranch), name: activeBranch,
      branch: activeBranch, workspaceId, isCollab: false, createdAt: now, updatedAt: now };
    lanes.push(local);
    activeLaneId = local.id;
  }
  return { activeLaneId, collabLaneId: shared.id, lanes };
}
