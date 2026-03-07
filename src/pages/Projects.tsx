import { useState, useMemo, useEffect, useCallback } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useCachedQuery } from '../stores/useQueryCache'
import { useProjectDiffStore } from '../stores/useProjectDiffStore'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import { cn } from '@/lib/utils'
import { ProjectCard } from '../features/projects/components/ProjectCard'
import { ProjectListRow } from '../features/projects/components/ProjectListRow'
import { SyncScreen } from '../features/projects/components/SyncScreen'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  Plus,
  ArrowUpDown,
  FileCode,
  FolderOpen,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog'

import { Badge } from '../components/ui/badge'
import { featureFlags } from '@/lib/featureFlags'
import type { SyncPlan, SyncProgress, SyncOperation } from '@/lib/sync/types'
import type { ProjectOpenSyncReviewRequest } from '@/features/projects/lib/projectOpenSyncReview'
import { isBootstrapOnlyLocalPath } from '@/features/projects/lib/localWorkspaceState'
import type { GitReplicaConflictDecision, GitReplicaPlanResult } from '@shared/electronApiTypes'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'


type SortOption = 'last_modified' | 'name' | 'created'
type StatusFilter = 'all' | 'active' | 'draft' | 'building' | 'archived'

interface PendingSyncReview {
  projectId: Id<'projects'>
  projectSlug: string
  projectName: string
  projectTemplate?: string | null
  projectPath: string
  originalPlan: SyncPlan
  workingPlan: SyncPlan
  replicaPlan: GitReplicaPlanResult
  requireSyncBeforeContinue: boolean
}

function createLocalPlaceholder(pathValue: string): SyncOperation['localEntry'] {
  return {
    path: pathValue,
    hash: '',
    size: 0,
    mtime: Date.now(),
  }
}

function createCloudPlaceholder(pathValue: string): SyncOperation['cloudEntry'] {
  return {
    _id: 'placeholder' as Id<'projectFiles'>,
    path: pathValue,
    hash: '',
    size: 0,
    version: 1,
    storageId: 'placeholder' as Id<'_storage'>,
    uploadedAt: Date.now(),
  }
}

function toSyncPlanFromReplicaPlan(replicaPlan: GitReplicaPlanResult): SyncPlan {
  return {
    downloads: replicaPlan.downloads.map((entry) => ({
      type: 'download',
      path: entry.path,
      reason: entry.reason,
      cloudEntry: createCloudPlaceholder(entry.path),
    })),
    uploads: replicaPlan.uploads.map((entry) => ({
      type: 'upload',
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
    })),
    localDeletes: replicaPlan.localDeletes.map((entry) => ({
      type: 'delete-local',
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
    })),
    cloudDeletes: replicaPlan.cloudDeletes.map((entry) => ({
      type: 'delete-cloud',
      path: entry.path,
      reason: entry.reason,
      cloudEntry: createCloudPlaceholder(entry.path),
    })),
    autoMerged: replicaPlan.autoMerged.map((entry) => ({
      type: 'auto-merged',
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
      cloudEntry: createCloudPlaceholder(entry.path),
      mergeDetails: {
        localChanges: 0,
        cloudChanges: 0,
        mergedContent: '',
      },
    })),
    conflicts: replicaPlan.conflicts.map((entry) => ({
      type: 'conflict',
      path: entry.path,
      reason: entry.reason,
      localEntry: entry.localExists ? createLocalPlaceholder(entry.path) : undefined,
      cloudEntry: entry.remoteExists ? createCloudPlaceholder(entry.path) : undefined,
    })),
    noChange: replicaPlan.noChange,
  }
}

function buildLocalWipeRecoveryPlan(plan: SyncPlan): SyncPlan {
  const restoreDownloads =
    plan.downloads.length > 0
      ? plan.downloads.map((entry) => ({
        ...entry,
        reason: 'Local workspace is empty; restore from cloud',
      }))
      : plan.cloudDeletes.map((entry) => ({
        type: 'download' as const,
        path: entry.path,
        reason: 'Local workspace is empty; restore from cloud',
        cloudEntry: createCloudPlaceholder(entry.path),
      }))

  return {
    downloads: restoreDownloads,
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    conflicts: [],
    autoMerged: [],
    noChange: restoreDownloads.length === 0 ? plan.noChange : 0,
  }
}

function hasSyncOperations(plan: SyncPlan): boolean {
  return (
    plan.downloads.length > 0 ||
    plan.uploads.length > 0 ||
    plan.localDeletes.length > 0 ||
    plan.cloudDeletes.length > 0 ||
    plan.autoMerged.length > 0 ||
    plan.conflicts.length > 0
  )
}

function isLocalWipeRecoveryCandidate(plan: SyncPlan): boolean {
  const hasNoLocalMutations =
    plan.uploads.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    plan.localDeletes.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    plan.conflicts.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    (plan.autoMerged?.every((entry) => isBootstrapOnlyLocalPath(entry.path)) ?? true)

  if (!hasNoLocalMutations) {
    return false
  }

  return plan.downloads.length > 0 || plan.cloudDeletes.length > 0
}

function deriveConflictDecisions(
  originalPlan: SyncPlan,
  resolvedPlan: SyncPlan
): Record<string, GitReplicaConflictDecision> {
  const decisions: Record<string, GitReplicaConflictDecision> = {}
  const addedUploads = new Set(
    resolvedPlan.uploads
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.uploads.some((item) => item.path === pathValue))
  )
  const addedDownloads = new Set(
    resolvedPlan.downloads
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.downloads.some((item) => item.path === pathValue))
  )
  const addedLocalDeletes = new Set(
    resolvedPlan.localDeletes
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.localDeletes.some((item) => item.path === pathValue))
  )
  const addedCloudDeletes = new Set(
    resolvedPlan.cloudDeletes
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.cloudDeletes.some((item) => item.path === pathValue))
  )

  for (const conflict of originalPlan.conflicts) {
    const pathValue = conflict.path
    if (conflict.localEntry && conflict.cloudEntry) {
      if (addedUploads.has(pathValue)) decisions[pathValue] = 'local'
      if (addedDownloads.has(pathValue)) decisions[pathValue] = 'cloud'
      continue
    }
    if (conflict.localEntry && !conflict.cloudEntry) {
      if (addedUploads.has(pathValue)) decisions[pathValue] = 'local'
      if (addedLocalDeletes.has(pathValue)) decisions[pathValue] = 'cloud'
      continue
    }
    if (!conflict.localEntry && conflict.cloudEntry) {
      if (addedCloudDeletes.has(pathValue)) decisions[pathValue] = 'local'
      if (addedDownloads.has(pathValue)) decisions[pathValue] = 'cloud'
    }
  }

  // Apply non-conflict intent overrides when caller rewrites the plan shape
  // (e.g. local-wipe recovery converting cloudDeletes -> downloads).
  const originalUploadPaths = new Set(originalPlan.uploads.map((entry) => entry.path))
  const resolvedUploadPaths = new Set(resolvedPlan.uploads.map((entry) => entry.path))
  const originalCloudDeletePaths = new Set(originalPlan.cloudDeletes.map((entry) => entry.path))
  const resolvedDownloadPaths = new Set(resolvedPlan.downloads.map((entry) => entry.path))

  for (const pathValue of originalUploadPaths) {
    if (!resolvedUploadPaths.has(pathValue)) {
      decisions[pathValue] = 'cloud'
    }
  }

  for (const pathValue of originalCloudDeletePaths) {
    if (resolvedDownloadPaths.has(pathValue)) {
      decisions[pathValue] = 'cloud'
    }
  }

  return decisions
}

function createIdleSyncProgress(): SyncProgress {
  return {
    status: 'idle',
    message: '',
    current: 0,
    total: 0,
    logs: [],
  }
}

export function Projects() {
  const { user, logout, currentOrganization } = useAuth()
  const navigate = useViewTransitionNavigate()
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)
  const clearDiff = useProjectDiffStore((state) => state.clearDiff)
  const [sortBy, setSortBy] = useState<SortOption>('last_modified')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [currentPage, setCurrentPage] = useState(1)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [pendingSyncReview, setPendingSyncReview] = useState<PendingSyncReview | null>(null)
  const [syncReviewProgress, setSyncReviewProgress] = useState<SyncProgress>(createIdleSyncProgress)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const effectiveViewMode = isMobile ? 'list' : viewMode
  const ITEMS_PER_PAGE = 20
  const isPersonalWorkspace = currentOrganization?.workspaceType === 'personal'

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `projects-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Get Convex user by WorkOS ID (needed for delete)
  const convexUser = useQuery(
    api.users.getByWorkosId,
    user?.id ? { workosId: user.id } : 'skip'
  )

  // Get organization members to display names
  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  const userMap = useMemo(() => {
    if (!members) return {}
    const map: Record<string, { name: string; image?: string }> = {}
    members.forEach((m) => {
      if (m.user) {
        map[m.userId] = {
          name: m.user.firstName || m.user.email.split('@')[0],
          image: m.user.profileImageUrl,
        }
      }
    })
    return map
  }, [members])

  // Query projects with source based on active workspace type (with caching)
  const freshProjects = useQuery(
    isPersonalWorkspace
      ? api.projects.listForPersonalWorkspaceMemberView
      : api.projects.listForOrganization,
    isPersonalWorkspace
      ? convexUser?._id
        ? { userId: convexUser._id }
        : 'skip'
      : convexOrg?._id
        ? { organizationId: convexOrg._id }
        : 'skip'
  )
  const projects = useCachedQuery(
    isPersonalWorkspace
      ? `projects-list-personal-${convexUser?._id}`
      : `projects-list-org-${convexOrg?._id}`,
    freshProjects
  )
  const normalizedProjects = useMemo(
    () => {
      const rows = projects ?? []
      return rows.filter((project): project is NonNullable<typeof project> => project !== null)
    },
    [projects]
  )

  const filteredProjects = useMemo(() => {
    let result = normalizedProjects

    if (statusFilter !== 'all') {
      if (statusFilter === 'building') {
        result = result.filter((project) => project.status === 'building' || project.status === 'generating')
      } else {
        result = result.filter((project) => project.status === statusFilter)
      }
    }

    return [...result].sort((left, right) => {
      switch (sortBy) {
        case 'name':
          return left.name.localeCompare(right.name)
        case 'created':
          return right.createdAt - left.createdAt
        case 'last_modified':
        default:
          return right.updatedAt - left.updatedAt
      }
    })
  }, [normalizedProjects, statusFilter, sortBy])

  // Pagination Logic
  const totalPages = Math.ceil(filteredProjects.length / ITEMS_PER_PAGE)
  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredProjects, currentPage])

  // Reset page when filter/sort changes
  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, sortBy])

  const isLoading = isPersonalWorkspace
    ? convexUser === undefined || projects === undefined
    : convexOrg === undefined || (convexOrg && projects === undefined)
  const hasProjects = normalizedProjects.length > 0
  const showProjectControls = hasProjects || isLoading

  const openProjectAfterSyncReview = useCallback((review: PendingSyncReview) => {
    navigate(buildProjectPath(String(review.projectId)), {
      state: {
        projectId: String(review.projectId),
        projectSlug: review.projectSlug,
        projectName: review.projectName,
        projectTemplate: review.projectTemplate ?? undefined,
        gateSyncScreen: false,
        skipInitialSyncCheck: true,
      },
    })
  }, [navigate])

  const executeSyncReviewPlan = useCallback(async (resolvedPlan: SyncPlan) => {
    if (!pendingSyncReview) return

    const activeReview = pendingSyncReview
    setPendingSyncReview((prev) => (prev ? { ...prev, workingPlan: resolvedPlan } : prev))
    setSyncReviewProgress((prev) => ({
      ...prev,
      status: 'syncing',
      message: 'Syncing files...',
      logs: [],
    }))

    if (!hasSyncOperations(resolvedPlan)) {
      setPendingSyncReview(null)
      setSyncReviewProgress(createIdleSyncProgress())
      openProjectAfterSyncReview(activeReview)
      return
    }

    try {
      if (convexUser?._id) {
        try {
          await updateSyncStatus({
            projectId: activeReview.projectId,
            userId: convexUser._id,
            status: 'syncing',
          })
        } catch (statusError) {
          console.error('[Projects] Failed to update syncing status:', statusError)
        }
      }

      const sessionId = activeReview.replicaPlan.sessionId ?? crypto.randomUUID()
      const conflictDecisions = deriveConflictDecisions(activeReview.originalPlan, resolvedPlan)

      if (activeReview.requireSyncBeforeContinue) {
        for (const entry of activeReview.originalPlan.cloudDeletes) {
          conflictDecisions[entry.path] = 'cloud'
        }
        for (const entry of activeReview.originalPlan.uploads) {
          conflictDecisions[entry.path] = 'cloud'
        }
      }

      console.log('[Projects] Executing replica apply', {
        projectId: String(activeReview.projectId),
        sessionId,
        decisions: Object.keys(conflictDecisions).length,
        requireSyncBeforeContinue: activeReview.requireSyncBeforeContinue,
      })

      const result = await window.electronAPI.sync.gitReplicaExecute({
        projectId: String(activeReview.projectId),
        projectPath: activeReview.projectPath,
        sessionId,
        conflictDecisions,
      })

      const syncErrorMessage = result.error || 'Failed to sync project files'

      if (convexUser?._id) {
        try {
          await updateSyncStatus({
            projectId: activeReview.projectId,
            userId: convexUser._id,
            status: result.success && result.applied ? 'synced' : 'error',
            errorMessage: result.success && result.applied ? undefined : syncErrorMessage,
          })
        } catch (statusError) {
          console.error('[Projects] Failed to update final sync status:', statusError)
        }
      }

      if (result.success && result.applied) {
        try {
          const verifyBootstrap = await window.electronAPI.sync.gitReplicaBootstrap({
            projectId: String(activeReview.projectId),
            projectPath: activeReview.projectPath,
          })
          if (!verifyBootstrap.success) {
            throw new Error(verifyBootstrap.error || 'Post-sync bootstrap failed')
          }

          const verifyPlan = await window.electronAPI.sync.gitReplicaPlan({
            projectId: String(activeReview.projectId),
            projectPath: activeReview.projectPath,
          })
          if (!verifyPlan.success) {
            throw new Error(verifyPlan.error || 'Post-sync plan failed')
          }

          const verifiedOriginalPlan = toSyncPlanFromReplicaPlan(verifyPlan)
          const verifiedRequireSyncBeforeContinue = isLocalWipeRecoveryCandidate(verifiedOriginalPlan)
          const verifiedWorkingPlan = verifiedRequireSyncBeforeContinue
            ? buildLocalWipeRecoveryPlan(verifiedOriginalPlan)
            : verifiedOriginalPlan

          const remainingChanges =
            verifyPlan.downloads.length +
            verifyPlan.uploads.length +
            verifyPlan.localDeletes.length +
            verifyPlan.cloudDeletes.length +
            verifyPlan.conflicts.length +
            verifyPlan.autoMerged.length

          if (remainingChanges > 0) {
            console.warn('[Projects] Post-sync verification still has pending changes', {
              projectId: String(activeReview.projectId),
              remainingChanges,
              downloads: verifyPlan.downloads.length,
              uploads: verifyPlan.uploads.length,
              localDeletes: verifyPlan.localDeletes.length,
              cloudDeletes: verifyPlan.cloudDeletes.length,
              conflicts: verifyPlan.conflicts.length,
              autoMerged: verifyPlan.autoMerged.length,
              requireSyncBeforeContinue: verifiedRequireSyncBeforeContinue,
            })

            setPendingSyncReview({
              ...activeReview,
              originalPlan: verifiedOriginalPlan,
              workingPlan: verifiedWorkingPlan,
              replicaPlan: verifyPlan,
              requireSyncBeforeContinue: verifiedRequireSyncBeforeContinue,
            })
            setSyncReviewProgress({
              status: 'planning',
              message: verifiedRequireSyncBeforeContinue
                ? 'Local files are missing. Restore from cloud?'
                : verifyPlan.conflicts.length > 0
                  ? `${verifyPlan.conflicts.length} conflict${verifyPlan.conflicts.length === 1 ? '' : 's'} detected`
                  : 'Sync changes detected',
              current: 0,
              total: 0,
              logs: verifiedRequireSyncBeforeContinue
                ? [
                  '⚠ Local workspace is empty. Preparing cloud restore.',
                  `Prepared ${verifiedWorkingPlan.downloads.length} files to download from cloud`,
                  'Click Download cloud files to restore your local workspace',
                ]
                : verifyPlan.conflicts.length > 0
                  ? [
                    `⚠ ${verifyPlan.conflicts.length} files have conflicts`,
                    'Manual resolution required',
                  ]
                  : ['Sync changes detected. Review and continue.'],
            })
            return
          }
        } catch (verificationError) {
          console.warn('[Projects] Post-sync verification failed, proceeding to open project', {
            projectId: String(activeReview.projectId),
            error: verificationError instanceof Error ? verificationError.message : 'Unknown error',
          })
        }

        clearDiff(activeReview.projectSlug)
        setSyncReviewProgress({
          status: 'complete',
          message: 'Sync complete',
          current: 0,
          total: 0,
          logs: [],
        })
        setPendingSyncReview(null)
        setSyncReviewProgress(createIdleSyncProgress())
        openProjectAfterSyncReview(activeReview)
        return
      }

      if (result.requiresConflictResolution) {
        setSyncReviewProgress((prev) => ({
          ...prev,
          status: 'planning',
          message: 'Conflict resolution required',
          logs: [...prev.logs, '⚠ Conflict resolution required before sync can continue'],
        }))
        return
      }

      setSyncReviewProgress({
        status: 'error',
        message: syncErrorMessage,
        current: 0,
        total: 0,
        logs: [`Error: ${syncErrorMessage}`],
      })
    } catch (error) {
      const syncErrorMessage = error instanceof Error ? error.message : 'Failed to sync project files'

      if (convexUser?._id) {
        try {
          await updateSyncStatus({
            projectId: activeReview.projectId,
            userId: convexUser._id,
            status: 'error',
            errorMessage: syncErrorMessage,
          })
        } catch (statusError) {
          console.error('[Projects] Failed to update sync error status:', statusError)
        }
      }

      setSyncReviewProgress({
        status: 'error',
        message: syncErrorMessage,
        current: 0,
        total: 0,
        logs: [`Error: ${syncErrorMessage}`],
      })
    }
  }, [pendingSyncReview, convexUser?._id, openProjectAfterSyncReview, updateSyncStatus, clearDiff])

  const handleRequireSyncReview = useCallback((request: ProjectOpenSyncReviewRequest) => {
    const originalPlan = toSyncPlanFromReplicaPlan(request.check.plan)
    const inferredLocalWipe = isLocalWipeRecoveryCandidate(originalPlan)
    const requireSyncBeforeContinue = request.check.likelyLocalWipe || inferredLocalWipe

    console.log('[Projects] Sync review gate', {
      projectId: String(request.projectId),
      likelyLocalWipeFromCheck: request.check.likelyLocalWipe,
      inferredLocalWipe,
      requireSyncBeforeContinue,
      downloads: originalPlan.downloads.length,
      uploads: originalPlan.uploads.length,
      cloudDeletes: originalPlan.cloudDeletes.length,
      localDeletes: originalPlan.localDeletes.length,
      conflicts: originalPlan.conflicts.length,
      autoMerged: originalPlan.autoMerged.length,
    })

    if (inferredLocalWipe && !request.check.likelyLocalWipe) {
      console.warn('[Projects] Local wipe fallback applied from sync plan pattern', {
        projectId: String(request.projectId),
      })
    }

    const workingPlan = requireSyncBeforeContinue
      ? buildLocalWipeRecoveryPlan(originalPlan)
      : originalPlan

    setPendingSyncReview({
      projectId: request.projectId,
      projectSlug: request.projectSlug,
      projectName: request.projectName,
      projectTemplate: request.projectTemplate,
      projectPath: request.projectPath,
      originalPlan,
      workingPlan,
      replicaPlan: request.check.plan,
      requireSyncBeforeContinue,
    })

    setSyncReviewProgress({
      status: 'planning',
      message: requireSyncBeforeContinue
        ? 'Local files are missing. Restore from cloud?'
        : request.check.hasConflicts
          ? `${request.check.plan.conflicts.length} conflict${request.check.plan.conflicts.length === 1 ? '' : 's'} detected`
          : 'Sync changes detected',
      current: 0,
      total: 0,
      logs: requireSyncBeforeContinue
        ? [
          '⚠ Local workspace is empty. Preparing cloud restore.',
          `Prepared ${workingPlan.downloads.length} files to download from cloud`,
          'Click Download cloud files to restore your local workspace',
        ]
        : request.check.hasConflicts
          ? [
            `⚠ ${request.check.plan.conflicts.length} files have conflicts`,
            'Manual resolution required',
          ]
          : ['Sync changes detected. Review and continue.'],
    })
  }, [])

  const handleSyncReviewContinue = useCallback(() => {
    if (!pendingSyncReview) return
    const target = pendingSyncReview
    setPendingSyncReview(null)
    setSyncReviewProgress(createIdleSyncProgress())
    openProjectAfterSyncReview(target)
  }, [pendingSyncReview, openProjectAfterSyncReview])

  const handleSyncReviewCancel = useCallback(() => {
    setPendingSyncReview(null)
    setSyncReviewProgress(createIdleSyncProgress())
  }, [])

  const handleSyncReviewRetry = useCallback(async () => {
    if (!pendingSyncReview) return
    await executeSyncReviewPlan(pendingSyncReview.workingPlan)
  }, [pendingSyncReview, executeSyncReviewPlan])

  const breadcrumbAddon = hasProjects ? (
    <Badge variant="secondary" className="text-xs font-normal">
      {normalizedProjects.length}
    </Badge>
  ) : null

  const headerContent = showProjectControls ? (
    <div className="flex items-center gap-2">
      {/* Status Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <FileCode className="h-3.5 w-3.5" />
            {statusFilter === 'all' ? 'All Status' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setStatusFilter('all')}>All Status</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('active')}>Active</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('draft')}>Draft</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('building')}>Building</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('archived')}>Archived</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Sort
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setSortBy('last_modified')}>Last modified</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSortBy('name')}>Name</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSortBy('created')}>Created date</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View Mode Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 px-0 rounded-full focus:z-10"
              onClick={() => setViewMode(effectiveViewMode === 'grid' ? 'list' : 'grid')}
              disabled={isMobile}
            >
              {effectiveViewMode === 'grid' ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isMobile ? 'View fixed to list on small screens' : 'Toggle view mode'}
        </TooltipContent>
      </Tooltip>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                className="gap-2 h-7 px-2 text-xs rounded-full"
                onClick={() => navigate('/projects/new')}
              >
                <Plus className="h-3.5 w-3.5" />
                New Project
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Create new project</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  ) : null

  const showPagination = filteredProjects.length > ITEMS_PER_PAGE

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Projects' }]}
      breadcrumbAddon={breadcrumbAddon}
      header={headerContent || undefined}
    >
      <TooltipProvider>
        {!isLoading && !hasProjects ? (
          <div className="flex min-h-full flex-1 items-center justify-center">
            <div className="w-full p-6 md:p-10">
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyMedia>
                    <FolderOpen className="h-8 w-8" />
                  </EmptyMedia>
                  <EmptyTitle>Start your first project</EmptyTitle>
                  <EmptyDescription>
                    Create a project to generate a plan, scaffold code, and collaborate with your team.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button className="gap-2" onClick={() => navigate('/projects/new')}>
                    <Plus className="h-4 w-4" />
                    Create Project
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          </div>
        ) : effectiveViewMode === 'grid' ? (
          <div
            className={cn(
              featureFlags.contentVisibility && 'perf-contain-auto',
              'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10'
            )}
          >
            {paginatedProjects.length > 0 ? (
              paginatedProjects.map((project) => (
                <ProjectCard
                  key={project._id}
                  project={project}
                  userId={convexUser?._id}
                  onRequireSyncReview={handleRequireSyncReview}
                />
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-border/60 bg-card/70 p-6 text-sm text-muted-foreground">
                {isLoading
                  ? 'Loading projects...'
                  : statusFilter === 'all'
                    ? 'No projects yet. Create your first project.'
                    : 'No projects match the current filters.'}
              </div>
            )}
          </div>
        ) : (
          <div className={cn(featureFlags.contentVisibility && 'perf-contain-auto', 'pb-10')}>
            <div
              className={cn(
                featureFlags.contentVisibility && 'perf-contain-card',
                'overflow-hidden rounded-2xl bg-secondary/80 px-2 py-1 dark:bg-secondary/40'
              )}
            >
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead className="w-[45%] sm:w-[38%] md:w-[32%]">Name</TableHead>
                    <TableHead className="w-[13%] text-center">Status</TableHead>
                    <TableHead className="hidden md:table-cell md:w-[24%]">Last modified by</TableHead>
                    <TableHead className="hidden lg:table-cell lg:w-[11%] text-center">Sync</TableHead>
                    <TableHead className="hidden sm:table-cell sm:w-[14%] text-right">Last modified</TableHead>
                    <TableHead className="w-[10%] text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {paginatedProjects.length > 0 ? (
                    paginatedProjects.map((project) => {
                      const modifier = userMap[project.lastSyncBy || project.createdBy]
                      return (
                        <ProjectListRow
                          key={project._id}
                          project={project}
                          userId={convexUser?._id}
                          creatorName={modifier?.name || 'Unknown'}
                          creatorImage={modifier?.image}
                          onRequireSyncReview={handleRequireSyncReview}
                        />
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                        {isLoading
                          ? 'Loading projects...'
                          : statusFilter === 'all'
                            ? 'No projects yet. Create your first project.'
                            : 'No projects match the current filters.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {!isLoading && filteredProjects.length === 0 && statusFilter === 'all' && (
              <div className="mt-3 flex justify-end">
                <Button className="gap-2" onClick={() => navigate('/projects/new')}>
                  <Plus className="h-4 w-4" />
                  Create Project
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Floating Pagination Pill */}
        {showPagination && (
          <div className="fixed bottom-8 right-4 z-50 flex items-center gap-1 bg-background/95 backdrop-blur border rounded-full shadow-lg px-1 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium px-2 min-w-[4rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Dialog
          open={Boolean(pendingSyncReview)}
          onOpenChange={(open) => {
            if (!open && pendingSyncReview) {
              handleSyncReviewCancel()
            }
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="w-[min(960px,calc(100vw-2rem))] max-w-none max-h-[85vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none"
          >
            {pendingSyncReview && (
              <>
                <DialogTitle className="sr-only">Project sync review</DialogTitle>
                <DialogDescription className="sr-only">
                  Review detected sync changes before opening the project workspace.
                </DialogDescription>
                <SyncScreen
                  progress={syncReviewProgress}
                  plan={pendingSyncReview.workingPlan}
                  onContinue={handleSyncReviewContinue}
                  onRetry={() => {
                    void handleSyncReviewRetry()
                  }}
                  onCancel={handleSyncReviewCancel}
                  onSync={(resolvedPlan) => {
                    void executeSyncReviewPlan(resolvedPlan)
                  }}
                  syncActionLabel={pendingSyncReview.requireSyncBeforeContinue ? 'Download cloud files' : undefined}
                  syncActionIcon={pendingSyncReview.requireSyncBeforeContinue ? 'download' : undefined}
                  hideContinue={pendingSyncReview.requireSyncBeforeContinue}
                  variant="panel"
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </DashboardLayout>
  )
}
