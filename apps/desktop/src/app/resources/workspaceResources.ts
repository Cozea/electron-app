/**
 * Consolidated Workspace & Branch Resources Engine
 * Conforms to Section 6 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Single in-flight request per key/generation shared by prefetch and mounted hooks (Invariant I06, N01, N02)
 * - Shared reconciliation scheduler: one interval per active demanded resource, NOT per component (F04, N07)
 * - Window focus/visibility pauses/resumes polling (N08)
 * - Strict non-mutating prefetch (Section 6.4, N15)
 * - Bounded LRU cache of up to 128 idle resource entries (Section 6.5)
 */

import { KeyedResource } from './keyedResource';
import { workspaceCatalogResource } from './workspaceCatalogResource';
import { buildResourceKey } from '@shared/navigationRuntimeTypes';
import type {
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
  RepoIdentity,
  WorkspaceCatalogSnapshotEntry,
} from '@shared/workspaceTypes';
import type { ProjectLaneState } from '@shared/electronApiTypes';
import {
  buildProjectBranchLaneState,
  readScopedProjectBranchSession,
  rememberProjectBranchSession,
  resolveLaneBranchKnowledge,
} from '@/features/source-control/model/projectBranchSessionStore';
import { publishGitRemoteStatus } from '@/features/source-control/model/gitRemoteStatusCache';
import { normalizeWorkspaceProjectPath } from '@/lib/workspaceIdentity';

type ResourceMetadata = { projectId?: string; workspaceId?: string | null };
const resourceMetadata = new Map<string, ResourceMetadata>();
const MAX_IDLE_ENTRIES = 128;
const MAX_IDLE_AGE_MS = 10 * 60_000;

function repoKey(repo: RepoIdentity | null | undefined): string | null {
  if (!repo) return null;
  return JSON.stringify([repo.provider, repo.url, 'fullName' in repo ? repo.fullName : null, 'projectId' in repo ? repo.projectId : null]);
}

function catalogResolution(projectId: string, preferredWorkspaceId?: string | null, expectedRepo?: RepoIdentity | null): ResolveProjectWorkspaceResult | null {
  const entry = workspaceCatalogResource.read()?.entries[projectId];
  if (!entry || entry.status !== 'ready' || entry.workspace.verificationStatus !== 'verified' || !entry.lane || !entry.runtimeIdentity) return null;
  if (preferredWorkspaceId && entry.workspace.workspaceId !== preferredWorkspaceId) return null;
  if (expectedRepo && repoKey(expectedRepo) !== repoKey(entry.workspace.gitRepoIdentity)) return null;
  if (entry.lane.workspaceId !== entry.workspace.workspaceId || entry.runtimeIdentity.workspaceRevision !== entry.workspace.workspaceRevision) return null;
  return { status: 'ready', projectId, workspace: entry.workspace, lane: entry.lane, runtimeIdentity: entry.runtimeIdentity, collaborationScopeId: entry.collaborationScopeId };
}

/** Speculation can only read the shared catalog. Never call resolveProject here:
 * that legacy endpoint can create a default lane and write verification/events. */
export async function prefetchWorkspaceResolution(projectId: string, preferredWorkspaceId?: string | null, projectSlug?: string | null): Promise<ResolveProjectWorkspaceResult | null> {
  await workspaceCatalogResource.ensure().catch(() => null);
  const result = catalogResolution(projectId, preferredWorkspaceId);
  if (result) {
    for (const allowScan of [false, true]) {
      getWorkspaceResolutionResource(projectId, preferredWorkspaceId, projectSlug, null, allowScan).prime(result);
    }
  }
  return result;
}

// 1. Workspace Resolution Resources
const resolutionResources = new Map<string, KeyedResource<ResolveProjectWorkspaceResult>>();

export function getWorkspaceResolutionResource(
  projectId: string,
  preferredWorkspaceId?: string | null,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  allowCandidateScan = false
): KeyedResource<ResolveProjectWorkspaceResult> {
  const key = buildResourceKey('workspaceResolution', {
    projectId,
    preferredWorkspaceId: preferredWorkspaceId ?? null,
    projectSlug: projectSlug ?? null,
    expectedRepo: repoKey(expectedRepo),
    allowCandidateScan,
  });

  let resource = resolutionResources.get(key);
  if (!resource) {
    resource = new KeyedResource<ResolveProjectWorkspaceResult>({
      key,
      ttlMs: 300_000, // 5 minutes cache
      fetcher: async () => {
        const workspaceApi = typeof window === 'undefined' ? undefined : window.electronAPI?.workspace;
        if (!workspaceApi) {
          throw new Error('Workspace API not available');
        }
        await workspaceCatalogResource.ensure().catch(() => null);
        const cached = catalogResolution(projectId, preferredWorkspaceId, expectedRepo);
        if (cached) return cached;
        const req: ResolveProjectWorkspaceRequest = {
          projectId,
          projectSlug: projectSlug ?? null,
          expectedRepo: expectedRepo ?? null,
          preferredWorkspaceId: preferredWorkspaceId ?? null,
          allowCandidateScan,
        };
        return await workspaceApi.resolveProject(req);
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });
    resolutionResources.set(key, resource);
    resourceMetadata.set(key, { projectId, workspaceId: preferredWorkspaceId });
    const cached = catalogResolution(projectId, preferredWorkspaceId, expectedRepo);
    if (cached) resource.prime(cached);
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;
}

export function invalidateProjectWorkspaceResolution(projectId: string): void {
  for (const [key, res] of resolutionResources.entries()) {
    if (resourceMetadata.get(key)?.projectId === projectId) {
      res.invalidate('explicit invalidation');
    }
  }
}

// 2. Git Status Resources
interface GitStatusData {
  success: boolean;
  currentBranch?: string | null;
  isRepo?: boolean;
  ahead?: number;
  behind?: number;
  error?: string | null;
}

const gitStatusResources = new Map<string, KeyedResource<GitStatusData>>();

export function getGitStatusResource(workspaceId: string): KeyedResource<GitStatusData> {
  const key = buildResourceKey('gitStatus', { workspaceId });
  let resource = gitStatusResources.get(key);
  if (!resource) {
    resource = new KeyedResource<GitStatusData>({
      key,
      ttlMs: 5_000,
      fetcher: async () => {
        const syncApi = typeof window === 'undefined' ? undefined : window.electronAPI?.workspaceSync;
        if (!syncApi) {
          return { success: false, error: 'Sync API unavailable' };
        }
        const res = await syncApi.gitStatus({ workspaceId }).catch((e) => ({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        }));
        if (res && res.success) {
          publishGitRemoteStatus(workspaceId, {
            ahead: 'ahead' in res ? (res.ahead ?? 0) : 0,
            behind: 'behind' in res ? (res.behind ?? 0) : 0,
            error: 'error' in res ? (res.error ?? null) : null,
          });
        }
        return res;
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });
    gitStatusResources.set(key, resource);
    resourceMetadata.set(key, { workspaceId });
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;
}

// 3. Project Lane State Resources
const laneResources = new Map<string, KeyedResource<ProjectLaneState | null>>();

function normalizeBranch(value: string | null | undefined, fallback = 'main'): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

export function getProjectLaneResource(
  projectId: string,
  workspaceId: string | null,
  collabBranch: string | null
): KeyedResource<ProjectLaneState | null> {
  const normalizedCollabBranch = normalizeBranch(collabBranch);
  const normalizedWorkspaceId = normalizeWorkspaceProjectPath(workspaceId);
  const key = buildResourceKey('projectLaneState', {
    projectId,
    workspaceId: normalizedWorkspaceId ?? 'unbound',
    collabBranch: normalizedCollabBranch,
  });

  let resource = laneResources.get(key);
  if (!resource) {
    resource = new KeyedResource<ProjectLaneState | null>({
      key,
      ttlMs: 5_000,
      fetcher: async (reason) => {
        if (!normalizedWorkspaceId) return null;
        const storedSession = readScopedProjectBranchSession(projectId, normalizedWorkspaceId);
        let activeBranch: string;

        if (normalizedWorkspaceId) {
          const gitRes = await getGitStatusResource(normalizedWorkspaceId).ensure(reason);
          const resolution = resolveLaneBranchKnowledge({
            statusResult: gitRes,
            storedBranch: storedSession?.activeBranch ?? null,
            collabBranch: normalizedCollabBranch,
          });
          if (resolution.kind === 'resolved') {
            activeBranch = resolution.branch;
            if (resolution.remember) {
              rememberProjectBranchSession({
                projectId,
                branch: resolution.branch,
                collabBranch: normalizedCollabBranch,
                workspaceId: normalizedWorkspaceId,
              });
            }
          } else {
            return null; // No fresh or previously verified branch knowledge.
          }
        } else {
          return null;
        }

        return buildProjectBranchLaneState({
          projectId,
          workspaceId: normalizedWorkspaceId,
          collabBranch: normalizedCollabBranch,
          activeBranch,
        });
      },
      equalityFn: (a, b) => {
        if (a === b) return true;
        if (!a || !b) return false;
        return JSON.stringify(a) === JSON.stringify(b);
      },
    });
    laneResources.set(key, resource);
    resourceMetadata.set(key, { projectId, workspaceId: normalizedWorkspaceId });
  }
  resource.touch();
  pruneIdleWorkspaceResources();
  return resource;
}

export function invalidateProjectLaneState(projectId: string): void {
  for (const [key, res] of laneResources.entries()) {
    if (resourceMetadata.get(key)?.projectId === projectId) {
      res.invalidate('explicit invalidation');
    }
  }
}

// 4. Central Reconciliation Scheduler (Section 6.5)
// One shared 5s timer for all demanded resources. Pauses on window blur/minimize.
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let isWindowVisible = typeof document === 'undefined' || !document.hidden;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isWindowVisible = !document.hidden;
    if (isWindowVisible) {
      // Shared resume stale refresh (N08)
      triggerDemandReconciliation('resume');
    }
  });
}

function triggerDemandReconciliation(reason: 'refresh' | 'resume') {
  if (!isWindowVisible) return;
  pruneIdleWorkspaceResources();

  // Refresh demanded lane resources
  for (const res of laneResources.values()) {
    if (res.getDemand('foreground') > 0 || res.getDemand('expanded-sidebar') > 0) {
      void res.ensure(reason).catch(() => {});
    }
  }
}

export function startReconciliationScheduler(): void {
  if (reconciliationTimer) return;
  reconciliationTimer = setInterval(() => {
    triggerDemandReconciliation('refresh');
  }, 5000);
}

export function stopReconciliationScheduler(): void {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
}

function bindingStamp(entry: WorkspaceCatalogSnapshotEntry | undefined): string {
  return JSON.stringify(entry ? [entry.status, entry.workspace.workspaceId, entry.workspace.workspaceRevision, entry.workspace.verificationStatus, entry.workspace.projectRootPath, entry.workspace.gitRootPath, entry.lane?.laneId ?? null] : null);
}

// No I/O during module import. The first actual catalog demand initializes it.
workspaceCatalogResource.observe((next, previous) => {
  // Initial resolution requests may be waiting for this first snapshot. There
  // is no previous binding to revoke, so do not supersede those very requests.
  if (!previous) return;
  const projectIds = new Set([...Object.keys(next.entries), ...Object.keys(previous?.entries ?? {})]);
  for (const projectId of projectIds) {
    const old = previous?.entries[projectId];
    const entry = next.entries[projectId];
    if (bindingStamp(old) === bindingStamp(entry)) continue;
    invalidateProjectWorkspaceResolution(projectId);
    invalidateProjectLaneState(projectId);
    const ids = new Set([old?.workspace.workspaceId, entry?.workspace.workspaceId]);
    for (const [key, resource] of gitStatusResources) {
      if (ids.has(resourceMetadata.get(key)?.workspaceId ?? undefined)) resource.invalidate('catalog binding changed');
    }
  }
});

/** Evict only undemanded, unsubscribed, settled handles; never interrupt a read. */
export function pruneIdleWorkspaceResources(now = Date.now()): void {
  const maps = [resolutionResources, gitStatusResources, laneResources] as const;
  const candidates = [...resolutionResources.values(), ...gitStatusResources.values(), ...laneResources.values()];
  const idle = candidates.filter(resource => resource.idle);
  idle.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
  let count = idle.length;
  for (const resource of idle) {
    if (count <= MAX_IDLE_ENTRIES && now - resource.lastAccessTime < MAX_IDLE_AGE_MS) continue;
    for (const map of maps) map.delete(resource.key);
    resourceMetadata.delete(resource.key);
    count--;
  }
}

// Only a browser runtime needs this timer. A shared demand starts it in the hook.
