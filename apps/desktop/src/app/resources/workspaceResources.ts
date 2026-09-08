import type { ProjectLaneState } from '@shared/electronApiTypes';
import type { RepoIdentity, ResolveProjectWorkspaceRequest, ResolveProjectWorkspaceResult, WorkspaceCatalogSnapshot } from '@shared/workspaceTypes';
import { buildResourceKey } from '@shared/navigationRuntimeTypes';
import { KeyedResource, ResourceAccessError, type ResourceReason } from './keyedResource';
import { ResourcePool } from './resourcePool';
import { workspaceCatalogMirror } from './workspaceCatalogMirror';
import {
  buildProjectBranchLaneState, ensureProjectBranchSessionReady, readScopedProjectBranchSession,
  rememberProjectBranchSession, resolveLaneBranchKnowledge,
} from '@/features/source-control/model/projectBranchSessionStore';
import { publishGitRemoteStatus } from '@/features/source-control/model/gitRemoteStatusCache';

export interface GitStatusData {
  success: boolean;
  isRepo?: boolean;
  currentBranch?: string | null;
  ahead?: number;
  behind?: number;
  error?: string | null;
}
interface ResourceMetadata { projectId?: string; workspaceId?: string; workspaceRevision?: number }
interface WorkspaceResourceDependencies {
  resolveProject(request: ResolveProjectWorkspaceRequest): Promise<ResolveProjectWorkspaceResult>;
  gitStatus(workspaceId: string): Promise<GitStatusData>;
  ensureCatalog(): Promise<WorkspaceCatalogSnapshot>;
  hydrateBranch(projectId: string, workspaceId: string): Promise<void>;
  readBranch(projectId: string, workspaceId: string): { activeBranch: string | null } | null;
  rememberBranch(input: { projectId: string; workspaceId: string; branch: string; collabBranch: string }): void;
  publishGit(workspaceId: string, status: GitStatusData): void;
}

export function laneStatesEqual(a: ProjectLaneState | null, b: ProjectLaneState | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.activeLaneId !== b.activeLaneId || a.collabLaneId !== b.collabLaneId || a.lanes.length !== b.lanes.length) return false;
  return a.lanes.every((lane, index) => {
    const other = b.lanes[index];
    return other && lane.id === other.id && lane.branch === other.branch && lane.name === other.name &&
      lane.workspaceId === other.workspaceId && lane.isCollab === other.isCollab;
  });
}
function repoKey(repo: RepoIdentity | null | undefined): string | null {
  return repo ? JSON.stringify([repo.provider, repo.url, 'fullName' in repo ? repo.fullName : null, 'projectId' in repo ? repo.projectId : null]) : null;
}
function demanded(resource: KeyedResource<unknown>): boolean {
  return resource.getDemand('foreground') > 0 || resource.getDemand('expanded-sidebar') > 0;
}

/** One read authority shared by prefetch, shell, sidebar and retained session consumers. */
export class WorkspaceResourceManager {
  private readonly resolution: ResourcePool<ResolveProjectWorkspaceResult, ResourceMetadata>;
  private readonly candidates: ResourcePool<ResolveProjectWorkspaceResult, ResourceMetadata>;
  private readonly git: ResourcePool<GitStatusData, ResourceMetadata>;
  private readonly lanes: ResourcePool<ProjectLaneState | null, ResourceMetadata>;
  private readonly bindings = new Map<string, { projectId: string; revision: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private visible = true;
  private schedulingEnabled = false;
  private generation = 0;

  private readonly dependencies: WorkspaceResourceDependencies;
  constructor(dependencies: WorkspaceResourceDependencies) {
    this.dependencies = dependencies;
    // Four independently typed pools have at most 32 idle entries apiece.
    const options = { maxIdle: 31, onDemandChange: () => this.updateScheduler() };
    this.resolution = new ResourcePool(options);
    this.candidates = new ResourcePool(options);
    this.git = new ResourcePool(options);
    this.lanes = new ResourcePool(options);
  }

  resolutionResource(input: ResolveProjectWorkspaceRequest, scan = false): KeyedResource<ResolveProjectWorkspaceResult> {
    const request: ResolveProjectWorkspaceRequest = { projectId: input.projectId.trim(), projectSlug: input.projectSlug ?? null,
      preferredWorkspaceId: input.preferredWorkspaceId ?? null, preferredLaneId: input.preferredLaneId ?? null,
      expectedRepo: input.expectedRepo ?? null, allowCandidateScan: scan };
    const key = buildResourceKey(scan ? 'workspaceCandidates' : 'workspaceResolution', {
      projectId: request.projectId, preferredWorkspaceId: request.preferredWorkspaceId ?? null,
      projectSlug: scan ? request.projectSlug ?? null : null, expectedRepo: repoKey(request.expectedRepo),
      preferredLaneId: request.preferredLaneId ?? null,
    });
    const pool = scan ? this.candidates : this.resolution;
    return pool.get(key, { projectId: request.projectId, workspaceId: request.preferredWorkspaceId ?? undefined }, {
      ttlMs: 300_000,
      fetcher: async ({ reason }) => {
        if (scan) {
          // Hover only prepares the bound-only resource. Navigation joins that
          // exact request and scans only if its result actually requires repair.
          const bound = await this.resolutionResource(request, false).ensure(reason);
          if (bound.status === 'ready' || reason === 'prefetch') return bound;
        } else {
          const catalog = await this.dependencies.ensureCatalog();
          this.learnBindings(catalog);
        }
        const result = await this.dependencies.resolveProject(request);
        if (result.projectId !== request.projectId) throw new ResourceAccessError('Workspace resolution returned another project.');
        if (result.status === 'ready') {
          if (request.preferredWorkspaceId && result.workspace.workspaceId !== request.preferredWorkspaceId) {
            throw new ResourceAccessError('Workspace resolution returned a different explicit binding.');
          }
          this.bindings.set(result.workspace.workspaceId, { projectId: request.projectId, revision: result.workspace.workspaceRevision });
        }
        return result;
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });
  }

  gitResource(workspaceId: string, revision?: number): KeyedResource<GitStatusData> {
    const bindingRevision = revision ?? this.bindings.get(workspaceId)?.revision ?? null;
    const key = buildResourceKey('gitStatus', { workspaceId, bindingRevision });
    return this.git.get(key, { workspaceId, workspaceRevision: bindingRevision ?? undefined }, {
      ttlMs: 5000,
      fetcher: async () => {
        const result = await this.dependencies.gitStatus(workspaceId);
        // Retain only branch/remote status, never the full changed-file listing.
        const data: GitStatusData = { success: result.success, isRepo: result.isRepo,
          currentBranch: result.currentBranch ?? null, ahead: result.ahead ?? 0, behind: result.behind ?? 0, error: result.error ?? null };
        this.dependencies.publishGit(workspaceId, data);
        return data;
      },
      equalityFn: (a, b) => a.success === b.success && a.isRepo === b.isRepo && a.currentBranch === b.currentBranch &&
        a.ahead === b.ahead && a.behind === b.behind && a.error === b.error,
    });
  }

  laneResource(projectId: string, workspaceId: string | null, collabBranch: string | null): KeyedResource<ProjectLaneState | null> {
    const normalizedProject = projectId.trim();
    const normalizedWorkspace = workspaceId?.trim() || null;
    const sharedBranch = collabBranch?.trim() || 'main';
    const key = buildResourceKey('projectLaneState', { projectId: normalizedProject, workspaceId: normalizedWorkspace, collabBranch: sharedBranch });
    return this.lanes.get(key, { projectId: normalizedProject, workspaceId: normalizedWorkspace ?? undefined }, {
      ttlMs: 5000,
      fetcher: async ({ reason }) => {
        if (!normalizedWorkspace) return null;
        const catalog = await this.dependencies.ensureCatalog();
        this.learnBindings(catalog);
        const binding = this.bindings.get(normalizedWorkspace);
        if (!binding || binding.projectId !== normalizedProject) throw new ResourceAccessError('No validated workspace identity exists for this lane.');
        const generation = this.generation;
        let branchHydrated = false;
        const hydration = this.dependencies.hydrateBranch(normalizedProject, normalizedWorkspace).then(() => { branchHydrated = true; }, () => undefined);
        const status = await this.gitResource(normalizedWorkspace, binding.revision).ensure(reason);
        await hydration;
        if (generation !== this.generation) throw new ResourceAccessError('Workspace binding changed during branch resolution.');
        // Old unversioned branch knowledge is not a safe fallback after a relink.
        const storedBranch = binding.revision === 1 && branchHydrated
          ? this.dependencies.readBranch(normalizedProject, normalizedWorkspace)?.activeBranch ?? null : null;
        const knowledge = resolveLaneBranchKnowledge({ statusResult: status, storedBranch, collabBranch: sharedBranch });
        if (knowledge.kind === 'unresolved') throw new Error(status.error || 'The workspace branch is not known yet.');
        if (knowledge.remember && branchHydrated && reason !== 'prefetch') {
          this.dependencies.rememberBranch({ projectId: normalizedProject, workspaceId: normalizedWorkspace,
            branch: knowledge.branch, collabBranch: sharedBranch });
        }
        return buildProjectBranchLaneState({ projectId: normalizedProject, workspaceId: normalizedWorkspace,
          collabBranch: sharedBranch, activeBranch: knowledge.branch });
      },
      equalityFn: laneStatesEqual,
    });
  }

  private learnBindings(snapshot: WorkspaceCatalogSnapshot): void {
    for (const entry of Object.values(snapshot.entries)) {
      const known = this.bindings.get(entry.workspace.workspaceId);
      if (entry.status === 'ready' && (!known || known.revision <= entry.workspace.workspaceRevision)) {
        this.bindings.set(entry.workspace.workspaceId, { projectId: entry.projectId, revision: entry.workspace.workspaceRevision });
      }
    }
  }
  catalogChanged(previous: WorkspaceCatalogSnapshot | null, next: WorkspaceCatalogSnapshot): void {
    this.learnBindings(next);
    if (!previous) return;
    const projectIds = new Set([...Object.keys(previous.entries), ...Object.keys(next.entries)]);
    for (const projectId of projectIds) {
      const old = previous.entries[projectId];
      const current = next.entries[projectId];
      if (old?.workspace.workspaceId === current?.workspace.workspaceId && old?.workspace.workspaceRevision === current?.workspace.workspaceRevision &&
          old?.status === current?.status) continue;
      if (old && (!current || current.workspace.workspaceId !== old.workspace.workspaceId || current.status !== 'ready')) this.bindings.delete(old.workspace.workspaceId);
      this.invalidateProject(projectId);
    }
  }
  invalidateProject(projectId: string): void {
    this.generation++;
    this.resolution.invalidate((metadata) => metadata.projectId === projectId, 'workspace binding changed');
    this.candidates.invalidate((metadata) => metadata.projectId === projectId, 'workspace binding changed');
    this.lanes.invalidate((metadata) => metadata.projectId === projectId, 'workspace binding changed');
    const workspaceIds = new Set(this.lanes.values().filter((entry) => entry.metadata.projectId === projectId).map((entry) => entry.metadata.workspaceId));
    this.git.invalidate((metadata) => workspaceIds.has(metadata.workspaceId), 'workspace binding changed');
    for (const pool of [this.resolution, this.candidates, this.lanes]) {
      for (const { resource, metadata } of pool.values()) if (metadata.projectId === projectId && demanded(resource as KeyedResource<unknown>)) {
        void resource.ensure('navigation').catch(() => undefined);
      }
    }
  }
  invalidateLanes(projectId: string, workspaceId?: string | null): void {
    this.lanes.invalidate((metadata) => metadata.projectId === projectId && (!workspaceId || metadata.workspaceId === workspaceId), 'branch changed');
    const affected = new Set(this.lanes.values().filter((entry) => entry.metadata.projectId === projectId &&
      (!workspaceId || entry.metadata.workspaceId === workspaceId)).map((entry) => entry.metadata.workspaceId));
    this.git.invalidate((metadata) => affected.has(metadata.workspaceId), 'branch changed');
    this.reconcile('refresh');
  }
  setVisible(visible: boolean): void {
    const resumed = visible && !this.visible;
    this.visible = visible;
    this.updateScheduler();
    if (resumed) this.reconcile('resume');
  }
  start(): void { this.schedulingEnabled = true; this.updateScheduler(); }
  stop(): void {
    this.schedulingEnabled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private updateScheduler(): void {
    const active = this.schedulingEnabled && this.visible && this.lanes.values().some(({ resource }) => demanded(resource as KeyedResource<unknown>));
    if (!active) { if (this.timer) clearInterval(this.timer); this.timer = null; return; }
    if (!this.timer) {
      this.timer = setInterval(() => this.reconcile('refresh'), 5000);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }
  reconcile(reason: Extract<ResourceReason, 'refresh' | 'resume'>): void {
    if (!this.visible) return;
    for (const { resource } of this.lanes.values()) if (demanded(resource as KeyedResource<unknown>)) {
      void resource.ensure(reason).catch(() => undefined);
    }
    for (const pool of [this.resolution, this.candidates, this.git, this.lanes]) pool.prune();
  }
  diagnostics(): { timerActive: boolean; cachedResources: number } {
    return { timerActive: this.timer !== null, cachedResources: this.resolution.size + this.candidates.size + this.git.size + this.lanes.size };
  }
}

export const workspaceResources = new WorkspaceResourceManager({
  resolveProject: async (request) => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.workspace;
    if (!api) throw new Error('Workspace API is unavailable.');
    return api.resolveProject(request);
  },
  gitStatus: async (workspaceId) => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.workspaceSync;
    if (!api) throw new Error('Workspace Git API is unavailable.');
    return api.gitStatus({ workspaceId });
  },
  ensureCatalog: () => workspaceCatalogMirror.ensure(),
  hydrateBranch: ensureProjectBranchSessionReady,
  readBranch: readScopedProjectBranchSession,
  rememberBranch: (input) => { rememberProjectBranchSession(input); },
  publishGit: (workspaceId, status) => publishGitRemoteStatus(workspaceId, { ahead: status.ahead ?? 0, behind: status.behind ?? 0, error: status.error ?? null }),
});

let stopCatalog: (() => void) | null = null;
let stopVisibility: (() => void) | null = null;
export function startReconciliationScheduler(): void {
  if (typeof document === 'undefined') return;
  stopCatalog ??= workspaceCatalogMirror.onChange((previous, next) => workspaceResources.catalogChanged(previous, next));
  if (!stopVisibility) {
    const visibility = () => workspaceResources.setVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    visibility();
    stopVisibility = () => document.removeEventListener('visibilitychange', visibility);
  }
  workspaceResources.start();
}
export function stopReconciliationScheduler(): void {
  workspaceResources.stop(); stopCatalog?.(); stopVisibility?.(); stopCatalog = null; stopVisibility = null;
}
export function getWorkspaceResolutionResource(projectId: string, preferredWorkspaceId?: string | null,
  projectSlug?: string | null, expectedRepo?: RepoIdentity | null, allowCandidateScan = false): KeyedResource<ResolveProjectWorkspaceResult> {
  return workspaceResources.resolutionResource({ projectId, preferredWorkspaceId, projectSlug, expectedRepo }, allowCandidateScan);
}
export function getGitStatusResource(workspaceId: string): KeyedResource<GitStatusData> { return workspaceResources.gitResource(workspaceId); }
export function getProjectLaneResource(projectId: string, workspaceId: string | null, collabBranch: string | null): KeyedResource<ProjectLaneState | null> {
  return workspaceResources.laneResource(projectId, workspaceId, collabBranch);
}
export function invalidateProjectWorkspaceResolution(projectId: string): void { workspaceResources.invalidateProject(projectId); }
export function invalidateProjectLaneState(projectId: string, workspaceId?: string | null): void { workspaceResources.invalidateLanes(projectId, workspaceId); }
