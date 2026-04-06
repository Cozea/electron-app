import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from '@/lib/router'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { RepositoryProvisioner } from '@/components/git/RepositoryProvisioner'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { useWorkspaceSourceControl } from '@/hooks/useWorkspaceSourceControl'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useLocalProjectPath } from '@/features/projects/hooks/useLocalProjectPath'
import { useOptionalProjectSyncContext } from '@/features/projects/contexts/ProjectSyncContext'
import { useProjectWorkspaceContext } from '@/features/projects/hooks/useProjectWorkspaceContext'
import { ProjectDeleteDialog } from '@/features/projects/components/ProjectDeleteDialog'
import { GitDurabilityCoordinator } from '@/lib/git/GitDurabilityCoordinator'
import { resolveProjectLaneGitContext } from '@/lib/git/projectLaneContext'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'
import {
  resolveProjectRepoAccessStatus,
} from '@/lib/git/projectRepoAccess'
import type { GitSyncStatusResult } from '@shared/electronApiTypes'
import {
  getDefaultVersionControlSetupMode,
  getVersionControlSetupLabel,
  normalizeVersionControlProvider,
  supportsVersionControlAutomation,
} from '@shared/versionControl'
import { formatProjectDeleteError } from '@/features/projects/lib/projectMutationPresentation'
import { buildLegacyProjectPath, buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react'
import type { ProjectGitRuntimeProjectLike } from '@/lib/git/projectGitRuntime'

type SettingsSectionId = 'general' | 'source-control' | 'danger'
type VersionControlProviderOption = 'github' | 'local'
type GitActionKey = 'status' | 'fetch' | 'pull' | 'commit' | 'push' | 'sync'

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'source-control', label: 'Source Control' },
  { id: 'danger', label: 'Danger' },
]

const VERSION_CONTROL_PROVIDER_OPTIONS: Array<{
  value: VersionControlProviderOption
  label: string
}> = [
  { value: 'github', label: 'GitHub' },
  { value: 'local', label: 'Local only' },
]

function normalizeProjectSettingsProviderOption(
  value: string | null | undefined
): VersionControlProviderOption {
  return normalizeVersionControlProvider(value) === 'github' ? 'github' : 'local'
}

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

export function ProjectSettingsPage() {
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const { section: sectionParam } = useParams()
  const { convexUserId } = useAuth()
  const { project, projectIdParam, slugParam } = useAccessibleProject()
  const syncContext = useOptionalProjectSyncContext()
  const projectWorkspace = useProjectWorkspaceContext(project)

  const currentSection: SettingsSectionId =
    sectionParam === 'danger' || sectionParam === 'source-control' ? sectionParam : 'general'

  const buildSettingsPath = useCallback((section: SettingsSectionId) => {
    if (project?._id) return buildProjectPath(String(project._id), `settings/${section}`)
    if (projectIdParam) return buildProjectPath(projectIdParam, `settings/${section}`)
    return slugParam ? buildLegacyProjectPath(slugParam, `settings/${section}`) : null
  }, [project?._id, projectIdParam, slugParam])

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)

  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    project?._id && convexUserId
      ? { projectId: project._id, userId: convexUserId }
      : 'skip'
  )
  const { localPath: resolvedLocalPath } = useLocalProjectPath({
    projectId: project?._id ? String(project._id) : projectIdParam,
    projectSlug: project?.slug ?? slugParam,
  })
  const memberLocalPath = syncContext?.projectPath ?? resolvedLocalPath

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<VersionControlProviderOption>('local')
  const [repoUrl, setRepoUrl] = useState('')
  const [activeCollabBranch, setActiveCollabBranch] = useState('main')
  const [syncPolicy, setSyncPolicy] = useState<'auto' | 'manual'>('auto')
  const [commitMessage, setCommitMessage] = useState('manual: sync workspace')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitNotice, setGitNotice] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<GitSyncStatusResult | null>(null)
  const [gitActionKey, setGitActionKey] = useState<GitActionKey | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const { getConnection } = useWorkspaceSourceControl({
    route: projectWorkspace.isPersonalWorkspace
      ? '/settings/source-control'
      : '/workspace/source-control',
    enabled: Boolean(project?.organizationId && convexUserId),
  })
  const repoIntegration =
    project?.organizationId && provider === 'github'
      ? getConnection(provider)
      : null
  const setupMode = useMemo(
    () => project?.sourceControl?.setupMode ?? getDefaultVersionControlSetupMode(projectWorkspace.isPersonalWorkspace),
    [project?.sourceControl?.setupMode, projectWorkspace.isPersonalWorkspace]
  )
  const normalizedRepoUrl = repoUrl.trim()
  const normalizedActiveCollabBranch = activeCollabBranch.trim() || 'main'
  const editableProject = useMemo<ProjectGitRuntimeProjectLike | null>(() => {
    if (!project) return null

    return {
      _id: project._id,
      organizationId: project.organizationId,
      gitRepository:
        provider !== 'local' && normalizedRepoUrl
          ? {
              provider,
              url: normalizedRepoUrl,
              defaultBranch: project?.gitRepository?.defaultBranch ?? normalizedActiveCollabBranch,
            }
          : null,
      sourceControl: {
        ...project.sourceControl,
        provider,
        repoUrl: normalizedRepoUrl || undefined,
        activeCollabBranch: normalizedActiveCollabBranch,
        defaultBranch: normalizedActiveCollabBranch,
        syncPolicy,
        setupMode,
      },
    }
  }, [
    normalizedActiveCollabBranch,
    normalizedRepoUrl,
    project,
    provider,
    setupMode,
    syncPolicy,
  ])
  const repoAccessStatus = useMemo(
    () =>
      resolveProjectRepoAccessStatus({
        project: editableProject,
        sourceControlConnection: repoIntegration,
        isPersonalWorkspace: projectWorkspace.isPersonalWorkspace,
      }),
    [editableProject, projectWorkspace.isPersonalWorkspace, repoIntegration]
  )

  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setProvider(normalizeProjectSettingsProviderOption(
      project.sourceControl?.provider ?? project.gitRepository?.provider
    ))
    setRepoUrl(project.gitRepository?.url ?? project.sourceControl?.repoUrl ?? '')
    setActiveCollabBranch(
      project.sourceControl?.activeCollabBranch ??
        project.sourceControl?.defaultBranch ??
        project.gitRepository?.defaultBranch ??
        'main'
    )
    setSyncPolicy(project.sourceControl?.syncPolicy === 'manual' ? 'manual' : 'auto')
    setSaveError(null)
    setGitError(null)
    setGitNotice(null)
    setGitStatus(null)
    setArchiveError(null)
    setDeleteError(null)
  }, [
    project?._id,
    project?.description,
    project?.gitRepository?.defaultBranch,
    project?.gitRepository?.provider,
    project?.gitRepository?.url,
    project?.name,
    project?.sourceControl?.activeCollabBranch,
    project?.sourceControl?.defaultBranch,
    project?.sourceControl?.provider,
    project?.sourceControl?.repoUrl,
    project?.sourceControl?.syncPolicy,
    project,
  ])

  const isManager = memberRole === 'project_manager'
  const canEditGeneral = memberRole !== null && memberRole !== undefined && memberRole !== 'viewer'

  const projectName = project?.name ?? ''
  const projectDescription = project?.description ?? ''
  const projectProvider =
    normalizeProjectSettingsProviderOption(project?.sourceControl?.provider ?? project?.gitRepository?.provider)
  const projectRepoUrl = project?.gitRepository?.url ?? project?.sourceControl?.repoUrl ?? ''
  const projectActiveCollabBranch =
    project?.sourceControl?.activeCollabBranch ??
    project?.sourceControl?.defaultBranch ??
    project?.gitRepository?.defaultBranch ??
    'main'
  const projectSyncPolicy = project?.sourceControl?.syncPolicy === 'manual' ? 'manual' : 'auto'
  const usesExistingRemote = project?.sourceControl?.workingCopyMode === 'attached'
  const hasRemoteOperations = Boolean(normalizedRepoUrl) || usesExistingRemote
  const hasChanges = Boolean(project) && (
    name !== projectName ||
    description !== projectDescription ||
    provider !== projectProvider ||
    normalizedRepoUrl !== projectRepoUrl ||
    normalizedActiveCollabBranch !== projectActiveCollabBranch ||
    syncPolicy !== projectSyncPolicy
  )
  const canSave = Boolean(convexUserId) && canEditGeneral && !isSaving && hasChanges && name.trim().length > 0

  const refreshGitStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!memberLocalPath) {
      setGitStatus(null)
      return
    }

    const isSilent = options?.silent === true
    if (!isSilent) {
      setGitActionKey('status')
      setGitError(null)
      setGitNotice(null)
    }

    try {
      const statusResult = await window.electronAPI.sync.gitStatus({
        projectPath: memberLocalPath,
      })
      if (!statusResult.success) {
        throw new Error(statusResult.error || 'Failed to read local git status')
      }
      setGitStatus(statusResult)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to read local git status'
      setGitStatus(null)
      if (!isSilent) {
        setGitError(message)
      }
    } finally {
      if (!isSilent) {
        setGitActionKey(null)
      }
    }
  }, [memberLocalPath])

  useEffect(() => {
    if (currentSection !== 'source-control' || !memberLocalPath) return
    void refreshGitStatus()
  }, [currentSection, memberLocalPath, refreshGitStatus])

  const resolveGitActionContext = useCallback(async () => {
    if (!project || !editableProject || !memberLocalPath) {
      throw new Error('Local project checkout is not available on this device.')
    }

    const context = await resolveProjectLaneGitContext({
      convex,
      project: editableProject,
      projectId: String(project._id),
      projectPath: memberLocalPath,
      collabBranch: normalizedActiveCollabBranch,
      userId: convexUserId,
    })

    return {
      branch: context.collabBranch,
      projectPath: context.collabLanePath,
      remoteConfig: context.remoteConfig,
    }
  }, [convex, convexUserId, editableProject, memberLocalPath, normalizedActiveCollabBranch, project])

  const recordSyncState = useCallback(async (
    status: 'syncing' | 'synced' | 'error',
    errorMessage?: string
  ) => {
    if (!project?._id || !convexUserId) return
    await updateSyncStatus({
      projectId: project._id,
      userId: convexUserId,
      status,
      errorMessage,
    })
  }, [convexUserId, project?._id, updateSyncStatus])

  const handleGitActionFailure = useCallback(async (message: string) => {
    try {
      await recordSyncState('error', message)
    } catch {
      // Ignore sync metadata failures and surface the git error itself.
    }
    setGitError(message)
  }, [recordSyncState])

  const finalizeGitAction = useCallback(async (notice: string, kind: 'dirty' | 'synced' | 'pulled' | 'published') => {
    if (!project || !memberLocalPath) return
    await recordSyncState('synced')
    setGitNotice(notice)
    dispatchGitStatusEvent({
      projectId: String(project._id),
      projectPath: memberLocalPath,
      kind,
    })
    await refreshGitStatus({ silent: true })
  }, [memberLocalPath, project, recordSyncState, refreshGitStatus])

  const handleFetch = useCallback(async () => {
    setGitActionKey('fetch')
    setGitError(null)
    setGitNotice(null)

    try {
      const { branch, projectPath, remoteConfig } = await resolveGitActionContext()
      if (!remoteConfig.repoUrl && !remoteConfig.usesExistingRemote) {
        throw new Error('This project does not have a remote repository configured yet.')
      }

      await recordSyncState('syncing')
      const fetchResult = await window.electronAPI.sync.gitFetchMain({
        projectPath,
        branch,
        repoUrl: remoteConfig.repoUrl,
        provider: remoteConfig.provider,
        accessToken: remoteConfig.accessToken,
      })
      if (!fetchResult.success) {
        throw new Error(fetchResult.error || 'Failed to fetch latest remote changes')
      }

      await finalizeGitAction('Fetched latest remote changes.', 'dirty')
    } catch (error) {
      await handleGitActionFailure(
        error instanceof Error ? error.message : 'Failed to fetch latest remote changes'
      )
    } finally {
      setGitActionKey(null)
    }
  }, [finalizeGitAction, handleGitActionFailure, recordSyncState, resolveGitActionContext])

  const handlePull = useCallback(async () => {
    setGitActionKey('pull')
    setGitError(null)
    setGitNotice(null)

    try {
      const { branch, projectPath, remoteConfig } = await resolveGitActionContext()
      if (!remoteConfig.repoUrl && !remoteConfig.usesExistingRemote) {
        throw new Error('This project does not have a remote repository configured yet.')
      }

      await recordSyncState('syncing')
      const pullResult = await window.electronAPI.sync.gitPullMain({
        projectPath,
        branch,
        repoUrl: remoteConfig.repoUrl,
        strategy: 'merge',
        provider: remoteConfig.provider,
        accessToken: remoteConfig.accessToken,
      })
      if (!pullResult.success) {
        throw new Error(pullResult.error || 'Failed to pull latest remote changes')
      }
      if (pullResult.hadConflicts) {
        throw new Error('Git merge conflicts must be resolved before continuing.')
      }

      await finalizeGitAction(
        pullResult.alreadyUpToDate ? 'Already up to date.' : 'Pulled latest remote changes.',
        'pulled'
      )
    } catch (error) {
      await handleGitActionFailure(
        error instanceof Error ? error.message : 'Failed to pull latest remote changes'
      )
    } finally {
      setGitActionKey(null)
    }
  }, [finalizeGitAction, handleGitActionFailure, recordSyncState, resolveGitActionContext])

  const handleCommit = useCallback(async () => {
    setGitActionKey('commit')
    setGitError(null)
    setGitNotice(null)

    const nextCommitMessage = commitMessage.trim()
    if (!nextCommitMessage) {
      setGitError('Commit message is required.')
      return
    }

    try {
      const { projectPath } = await resolveGitActionContext()
      await recordSyncState('syncing')
      const commitResult = await window.electronAPI.sync.gitCommitAll({
        projectPath,
        message: nextCommitMessage,
      })
      if (!commitResult.success) {
        throw new Error(commitResult.error || 'Failed to create git commit')
      }

      await finalizeGitAction(
        commitResult.commitCreated === false
          ? 'No local changes to commit.'
          : 'Created local git commit.',
        'dirty'
      )
    } catch (error) {
      await handleGitActionFailure(
        error instanceof Error ? error.message : 'Failed to create git commit'
      )
    } finally {
      setGitActionKey(null)
    }
  }, [commitMessage, finalizeGitAction, handleGitActionFailure, recordSyncState, resolveGitActionContext])

  const handlePush = useCallback(async () => {
    setGitActionKey('push')
    setGitError(null)
    setGitNotice(null)

    try {
      const { branch, projectPath, remoteConfig } = await resolveGitActionContext()
      if (!remoteConfig.repoUrl && !remoteConfig.usesExistingRemote) {
        throw new Error('This project does not have a remote repository configured yet.')
      }

      await recordSyncState('syncing')
      const pushResult = await window.electronAPI.sync.gitPushMain({
        projectPath,
        branch,
        repoUrl: remoteConfig.repoUrl,
        provider: remoteConfig.provider,
        accessToken: remoteConfig.accessToken,
      })
      if (!pushResult.success) {
        throw new Error(pushResult.error || 'Failed to push local git commits')
      }

      await finalizeGitAction(
        pushResult.pushed === false ? 'No local commits to push.' : 'Pushed local commits.',
        'published'
      )
    } catch (error) {
      await handleGitActionFailure(
        error instanceof Error ? error.message : 'Failed to push local git commits'
      )
    } finally {
      setGitActionKey(null)
    }
  }, [finalizeGitAction, handleGitActionFailure, recordSyncState, resolveGitActionContext])

  const handleSyncNow = useCallback(async () => {
    if (!project?._id || !convexUserId || !memberLocalPath) {
      setGitError('Local project checkout is not available on this device.')
      return
    }

    setGitActionKey('sync')
    setGitError(null)
    setGitNotice(null)

    try {
      const collabLane = await window.electronAPI.project.ensureCollabLane({
        projectId: String(project._id),
        projectPath: memberLocalPath,
        branch: normalizedActiveCollabBranch,
      })
      const resolvedCollabLane =
        collabLane.lanes.find((lane) => lane.id === collabLane.collabLaneId) ?? null
      const collabProjectPath = resolvedCollabLane?.projectPath ?? memberLocalPath
      const coordinator = GitDurabilityCoordinator.acquireShared({
        projectId: project._id,
        projectPath: collabProjectPath,
        convex,
        userId: convexUserId,
      })

      try {
        await recordSyncState('syncing')
        await coordinator.flushNow(true)
        await finalizeGitAction('Git sync complete.', 'synced')
      } finally {
        coordinator.release()
      }
    } catch (error) {
      await handleGitActionFailure(
        error instanceof Error ? error.message : 'Failed to complete git sync'
      )
    } finally {
      setGitActionKey(null)
    }
  }, [convex, convexUserId, finalizeGitAction, handleGitActionFailure, memberLocalPath, normalizedActiveCollabBranch, project?._id, recordSyncState])

  const handleSave = useCallback(async () => {
    if (!project || !convexUserId) return

    const nextName = name.trim()
    if (!nextName) {
      setSaveError('Project name is required.')
      return
    }
    if (!hasChanges) return

    setIsSaving(true)
    setSaveError(null)

    try {
      await updateProject({
        projectId: project._id,
        userId: convexUserId,
        name: nextName,
        description,
        sourceControl: {
          provider,
          repoUrl: normalizedRepoUrl || undefined,
          activeCollabBranch: normalizedActiveCollabBranch,
          defaultBranch: normalizedActiveCollabBranch,
          syncPolicy,
          setupMode,
        },
      })
    } catch (error) {
      setSaveError(cleanConvexError(error, 'Failed to save project settings'))
    } finally {
      setIsSaving(false)
    }
  }, [
    convexUserId,
    description,
    hasChanges,
    name,
    normalizedActiveCollabBranch,
    normalizedRepoUrl,
    project,
    provider,
    setupMode,
    syncPolicy,
    updateProject,
  ])

  const handleArchive = useCallback(async () => {
    if (!project || !convexUserId) return

    setIsArchiving(true)
    setArchiveError(null)
    try {
      await archiveProject({
        projectId: project._id,
        userId: convexUserId,
      })
      setShowArchiveDialog(false)
      navigate('/projects')
    } catch (error) {
      setArchiveError(cleanConvexError(error, 'Failed to archive project'))
    } finally {
      setIsArchiving(false)
    }
  }, [archiveProject, convexUserId, navigate, project])

  const handleDelete = useCallback(async (confirmName: string) => {
    if (!project || !convexUserId || confirmName !== project.name) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await removeProject({
        projectId: project._id,
        userId: convexUserId,
        confirmName,
      })
      setShowDeleteDialog(false)
      navigate('/projects')
    } catch (error) {
      const presentation = formatProjectDeleteError(error)
      setDeleteError(
        presentation.detail
          ? `${presentation.message} ${presentation.detail}`
          : presentation.message
      )
    } finally {
      setIsDeleting(false)
    }
  }, [convexUserId, navigate, project, removeProject])

  const headerActions = useMemo(() => {
    if (currentSection !== 'general' && currentSection !== 'source-control') return null
    return (
      <Button
        size="sm"
        variant="secondary"
        className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
        onClick={() => {
          void handleSave()
        }}
        disabled={!canSave}
      >
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Button>
    )
  }, [canSave, currentSection, handleSave, isSaving])

  useProjectHeader(headerActions)

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <div className="h-[calc(100%+2.5rem)] -mt-10">
      <ScrollArea className="h-full">
        <div className="w-full min-h-full px-4 pt-16 pb-6 xl:px-3">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-border/60 bg-card/50 p-2">
              <div className="space-y-1">
                {SETTINGS_SECTIONS.map((section) => {
                  const isActive = currentSection === section.id
                  const targetPath = buildSettingsPath(section.id)
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`flex h-9 w-full items-center rounded-lg px-3 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      }`}
                      onClick={() => {
                        if (targetPath) navigate(targetPath, { replace: true })
                      }}
                    >
                      {section.label}
                    </button>
                  )
                })}
              </div>
            </aside>

            <section className="space-y-5">
              {currentSection === 'general' ? (
                <div className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-5">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                      }}
                      placeholder="My Project"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value)
                      }}
                      placeholder="A brief description of your project..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="slug">Project Slug</Label>
                    <Input id="slug" value={project.slug || ''} disabled />
                    <p className="text-xs text-muted-foreground">
                      Slug is retained for compatibility links. Canonical routes use project id.
                    </p>
                  </div>

                  {saveError ? (
                    <p className="text-xs text-destructive">{saveError}</p>
                  ) : null}
                </div>
              ) : null}

              {currentSection === 'source-control' ? (
                <div className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-5">
                  <div className="rounded-xl border border-border/60 bg-secondary/40 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{repoAccessStatus.title}</p>
                        <p className="text-xs text-muted-foreground">{repoAccessStatus.description}</p>
                      </div>
                      {repoAccessStatus.state === 'integration_missing' || repoAccessStatus.state === 'integration_mismatch' ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-full"
                          onClick={() => {
                            navigate(projectWorkspace.isPersonalWorkspace ? '/settings/source-control' : '/workspace/source-control')
                          }}
                        >
                          {repoAccessStatus.state === 'integration_mismatch' ? 'Fix Source Control' : 'Connect Source Control'}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select
                      value={provider}
                      onValueChange={(value) => {
                        const nextProvider = value as VersionControlProviderOption
                        setProvider(nextProvider)
                        if (nextProvider === 'local') {
                          setRepoUrl('')
                        }
                      }}
                    >
                      <SelectTrigger className="rounded-xl bg-background">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {VERSION_CONTROL_PROVIDER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Remote URL</Label>
                    <Input
                      value={repoUrl}
                      onChange={(event) => {
                        setRepoUrl(event.target.value)
                      }}
                      placeholder={usesExistingRemote ? 'Uses the remote configured in your attached checkout' : 'https://github.com/owner/repo'}
                    />
                    <p className="text-xs text-muted-foreground">
                      {usesExistingRemote && !normalizedRepoUrl
                        ? 'Leave this blank to keep using the remote configured in the attached checkout.'
                        : 'This remote is owned by your connected git provider, not by the app.'}
                    </p>
                  </div>

                  {supportsVersionControlAutomation(provider) && project.organizationId ? (
                    <RepositoryProvisioner
                      provider={provider}
                      organizationId={project.organizationId}
                      integrationConnected={Boolean(repoIntegration)}
                      setupMode={setupMode}
                      selectedRepoUrl={normalizedRepoUrl}
                      suggestedRepoName={name}
                      visibility={project.sourceControl?.visibility ?? 'private'}
                      onRepositorySelected={(repository) => {
                        setRepoUrl(repository.url)
                        setActiveCollabBranch(repository.defaultBranch || 'main')
                      }}
                    />
                  ) : null}

                  <div className="space-y-2">
                    <Label>Active Collab Branch</Label>
                    <Input
                      value={activeCollabBranch}
                      onChange={(event) => {
                        setActiveCollabBranch(event.target.value)
                      }}
                      placeholder="main"
                    />
                    <p className="text-xs text-muted-foreground">
                      This is the shared branch the app syncs and collaborates against. Personal local lanes will target their own branches separately.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Repository Default Branch</Label>
                    <Input
                      value={project.gitRepository?.defaultBranch ?? 'main'}
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Provider metadata for the repository itself. It is shown here for reference and no longer drives the app’s active sync target.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Working Copy</Label>
                    <Input
                      value={usesExistingRemote ? 'Attached checkout' : 'Managed workspace'}
                      disabled
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Provider Setup</Label>
                    <Input
                      value={getVersionControlSetupLabel({
                        provider,
                        setupMode,
                      })}
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      {projectWorkspace.isPersonalWorkspace
                        ? 'Personal workspaces use personal provider ownership.'
                        : 'Organization workspaces require non-personal provider ownership.'}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label>Sync Mode</Label>
                    <RadioGroup
                      value={syncPolicy}
                      onValueChange={(value) => {
                        setSyncPolicy(value === 'manual' ? 'manual' : 'auto')
                      }}
                      className="space-y-3"
                    >
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-4">
                        <RadioGroupItem value="auto" id="sync-auto" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Automatic</p>
                          <p className="text-xs text-muted-foreground">
                            The app commits, fetches, pulls, and pushes for you when the workspace changes.
                          </p>
                        </div>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-4">
                        <RadioGroupItem value="manual" id="sync-manual" className="mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Manual</p>
                          <p className="text-xs text-muted-foreground">
                            The app still tracks git status, but commit, pull, and push happen only when you trigger them.
                          </p>
                        </div>
                      </label>
                    </RadioGroup>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Local git status</p>
                        <p className="text-xs text-muted-foreground">
                          {memberLocalPath
                            ? memberLocalPath
                            : 'This project has not been opened on this device yet.'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-full"
                        onClick={() => {
                          void refreshGitStatus()
                        }}
                        disabled={!memberLocalPath || gitActionKey === 'status'}
                      >
                        {gitActionKey === 'status' ? 'Refreshing...' : 'Refresh Status'}
                      </Button>
                    </div>

                    {gitStatus ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="rounded-full">
                          {gitStatus.currentBranch || normalizedActiveCollabBranch}
                        </Badge>
                        <Badge variant={gitStatus.clean ? 'outline' : 'secondary'} className="rounded-full">
                          {gitStatus.clean ? 'Clean' : 'Dirty'}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {`${gitStatus.ahead ?? 0} ahead`}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {`${gitStatus.behind ?? 0} behind`}
                        </Badge>
                        {gitStatus.hasConflicts ? (
                          <Badge variant="destructive" className="rounded-full">
                            Conflicts
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="manual-commit-message">Commit Message</Label>
                        <Input
                          id="manual-commit-message"
                          value={commitMessage}
                          onChange={(event) => {
                            setCommitMessage(event.target.value)
                          }}
                          placeholder="manual: sync workspace"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full rounded-xl"
                          onClick={() => {
                            void handleFetch()
                          }}
                          disabled={!memberLocalPath || !hasRemoteOperations || gitActionKey !== null}
                        >
                          {gitActionKey === 'fetch' ? 'Fetching...' : 'Fetch'}
                        </Button>
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full rounded-xl"
                          onClick={() => {
                            void handlePull()
                          }}
                          disabled={!memberLocalPath || !hasRemoteOperations || gitActionKey !== null}
                        >
                          {gitActionKey === 'pull' ? 'Pulling...' : 'Pull'}
                        </Button>
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full rounded-xl"
                          onClick={() => {
                            void handleCommit()
                          }}
                          disabled={!memberLocalPath || gitActionKey !== null}
                        >
                          {gitActionKey === 'commit' ? 'Committing...' : 'Commit'}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-xl"
                        onClick={() => {
                          void handlePush()
                        }}
                        disabled={!memberLocalPath || !hasRemoteOperations || gitActionKey !== null}
                      >
                        {gitActionKey === 'push' ? 'Pushing...' : 'Push'}
                      </Button>
                      <Button
                        type="button"
                        className="rounded-xl"
                        onClick={() => {
                          void handleSyncNow()
                        }}
                        disabled={!memberLocalPath || !hasRemoteOperations || gitActionKey !== null}
                      >
                        {gitActionKey === 'sync' ? 'Syncing...' : 'Sync Now'}
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {syncPolicy === 'manual'
                        ? 'Manual mode disables background commit, pull, and push. Use these buttons when you want to update the repository.'
                        : 'Automatic mode still runs background git durability, but these controls are available for explicit repo operations.'}
                    </p>
                  </div>

                  {gitNotice ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">{gitNotice}</p>
                  ) : null}
                  {gitError ? (
                    <p className="text-xs text-destructive">{gitError}</p>
                  ) : null}

                  {saveError ? (
                    <p className="text-xs text-destructive">{saveError}</p>
                  ) : null}
                </div>
              ) : null}

              {currentSection === 'danger' ? (
                <div className="space-y-4">
                  <h3 className="text-base font-medium flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Danger Zone
                  </h3>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-destructive/5 p-5">
                    <div>
                      <h4 className="font-medium">Archive Project</h4>
                      <p className="text-sm text-muted-foreground">
                        Archive this project. It can be restored later.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="text-orange-500 hover:text-orange-600"
                      disabled={!convexUserId || !isManager || project.status === 'archived'}
                      onClick={() => {
                        setShowArchiveDialog(true)
                        setArchiveError(null)
                      }}
                    >
                      {project.status === 'archived' ? 'Archived' : 'Archive Project'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-destructive/5 p-5">
                    <div>
                      <h4 className="font-medium">Delete Project</h4>
                      <p className="text-sm text-muted-foreground">
                        Permanently delete this project and all its data. This action cannot be undone.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      disabled={!convexUserId}
                      onClick={() => {
                        setShowDeleteDialog(true)
                        setDeleteError(null)
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Project
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <span className="font-semibold">{project.name}</span>. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? <p className="text-sm text-destructive">{archiveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleArchive()
              }}
              disabled={isArchiving}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isArchiving ? 'Archiving...' : 'Archive Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectDeleteDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setDeleteError(null)
          }
        }}
        projectName={project.name}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        errorMessage={deleteError}
      />
    </div>
  )
}
