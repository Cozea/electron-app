/**
 * Consolidated Workspace & Branch Resources Engine
 * Conforms to Section 6 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Single in-flight request per key/generation shared by prefetch and mounted hooks (Invariant I06, N01, N02)
 * - Shared reconciliation scheduler: one interval per active demanded resource, NOT per component (F04, N07)
 * - Window focus/visibility pauses/resumes polling (N08)
 * - Strict non-mutating prefetch (Section 6.4, N15)
 * - Bounded LRU caches of up to 128 entries per resource type (Section 6.5)
 */

import { KeyedResource, type ResourceEnsureReason } from './keyedResource';
import { buildResourceKey } from '@shared/navigationRuntimeTypes';
import type {
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
  RepoIdentity,
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

const MAX_RESOURCE_ENTRIES = 128;

function readResourceParts(key: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return null;
    return Object.fromEntries(
      parsed[1].filter(
        (entry): entry is [string, unknown] =>
          Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
      ),
    );
  } catch {
    return null;
  }
}

function getCachedResource<T>(
  resources: Map<string, KeyedResource<T>>,
  key: string,
  create: () => KeyedResource<T>,
): KeyedResource<T> {
  const existing = resources.get(key);
  if (existing) {
    resources.delete(key);
    resources.set(key, existing);
    return existing;
  }
  const resource = create();
  resources.set(key, resource);
  for (const [candidateKey, candidate] of resources) {
    if (resources.size <= MAX_RESOURCE_ENTRIES) break;
    if (candidate.getTotalDemand() === 0 && !candidate.hasInFlightRequest()) {
      resources.delete(candidateKey);
    }
  }
  return resource;
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
    expectedRepo: expectedRepo ?? null,
    allowCandidateScan,
  });

  return getCachedResource(resolutionResources, key, () =>
    new KeyedResource<ResolveProjectWorkspaceResult>({
      key,
      ttlMs: 300_000, // 5 minutes cache
      fetcher: async () => {
        const workspaceApi = typeof window === 'undefined' ? undefined : window.electronAPI?.workspace;
        if (!workspaceApi) {
          throw new Error('Workspace API not available');
        }
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
    })
  );
}

export function invalidateProjectWorkspaceResolution(projectId: string): void {
  for (const [key, res] of resolutionResources.entries()) {
    if (readResourceParts(key)?.projectId === projectId) {
      res.invalidate('explicit invalidation');
    }
  }
}

// 2. Git Status Resources
interface GitStatusData {
  success: boolean;
  currentBranch?: string | null;
  ahead?: number;
  behind?: number;
  error?: string | null;
}

const gitStatusResources = new Map<string, KeyedResource<GitStatusData>>();

export function getGitStatusResource(workspaceId: string): KeyedResource<GitStatusData> {
  const key = buildResourceKey('gitStatus', { workspaceId });
  return getCachedResource(gitStatusResources, key, () =>
    new KeyedResource<GitStatusData>({
      key,
      ttlMs: 5_000,
      fetcher: async (reason, isCurrent) => {
        const syncApi = typeof window === 'undefined' ? undefined : window.electronAPI?.workspaceSync;
        if (!syncApi) {
          return { success: false, error: 'Sync API unavailable' };
        }
        const res = await syncApi.gitStatus({ workspaceId }).catch((e) => ({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        }));
        if (res && res.success && reason !== 'prefetch' && isCurrent()) {
          publishGitRemoteStatus(workspaceId, {
            ahead: 'ahead' in res ? (res.ahead ?? 0) : 0,
            behind: 'behind' in res ? (res.behind ?? 0) : 0,
            error: 'error' in res ? (res.error ?? null) : null,
          });
        }
        return res;
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    })
  );
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

  return getCachedResource(laneResources, key, () =>
    new KeyedResource<ProjectLaneState | null>({
      key,
      ttlMs: 5_000,
      fetcher: async (reason: ResourceEnsureReason, isCurrent) => {
        const storedSession = readScopedProjectBranchSession(projectId, normalizedWorkspaceId);
        if (!normalizedWorkspaceId) return null;
        let activeBranch: string;

        const gitRes = await getGitStatusResource(normalizedWorkspaceId).ensure(reason);
        const resolution = resolveLaneBranchKnowledge({
          statusResult: gitRes,
          storedBranch: storedSession?.activeBranch ?? null,
          collabBranch: normalizedCollabBranch,
        });
        if (resolution.kind !== 'resolved') return null;
        activeBranch = resolution.branch;
        if (resolution.remember && reason !== 'prefetch' && isCurrent()) {
          rememberProjectBranchSession({
            projectId,
            branch: resolution.branch,
            collabBranch: normalizedCollabBranch,
            workspaceId: normalizedWorkspaceId,
          });
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
    })
  );
}

export function invalidateProjectLaneState(projectId: string, workspaceId?: string | null): void {
  const normalizedWorkspaceId = workspaceId === undefined
    ? undefined
    : (normalizeWorkspaceProjectPath(workspaceId) ?? 'unbound');
  for (const [key, res] of laneResources.entries()) {
    const parts = readResourceParts(key);
    if (
      parts?.projectId === projectId &&
      (normalizedWorkspaceId === undefined || parts.workspaceId === normalizedWorkspaceId)
    ) {
      res.invalidate('explicit invalidation');
    }
  }
}

// 4. Central Reconciliation Scheduler (Section 6.5)
// One shared 5s timer for all demanded resources. Pauses on window blur/minimize.
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let isWindowVisible = true;

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
  if (!isWindowVisible && reason !== 'resume') return;

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

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startReconciliationScheduler();
}
