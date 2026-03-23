import { useEffect, useMemo, useState } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useAuth } from '../contexts/AuthContext'
import { useProjectTargetScope } from '@/hooks/useProjectTargetScope'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft, ArrowLeftRight, ArrowRight, RefreshCw, Rocket, Search, Loader2 } from 'lucide-react'
import type { Id } from '../../convex/_generated/dataModel'

import {
  WizardLayout,
  EntryChoice,
  TeamStep,
  ReviewStep,
  WizardConversation,
  RepoSourceStep,
  type GuidedEntryChoice,
  type PromptSettings,
  type PlanOption,
  type OrgMember,
} from '../components/wizard'
import { useWizardState, type WizardTeamMember } from '../hooks/useWizardState'
import { useMutation, useQuery, useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { getDefaultWebBuildContract, normalizeGeneratedPlan, validateWebOnlyPlanConfig } from '../lib/plan'
import { detectFramework } from '../utils/projectDetector'
import { cn } from '@/lib/utils'
import { ensureProjectRuntimeToolchains, runtimeLabel } from '@/lib/runtime/projectRuntimePreflight'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { logDeferredTeamSetupDebug } from '@/lib/projects/deferredTeamSetupDebug'
import { getDefaultVersionControlSetupMode } from '@shared/versionControl'
import { useWorkspaceSourceControl } from '@/hooks/useWorkspaceSourceControl'
import { readSourceControlProviderPreferences } from '@/lib/sourceControlPreferences'
import { resolveSourceControlProviderPreference } from '@/lib/sourceControlDefaultProvider'

type RepoIntegrationProvider = 'github' | 'gitlab'

function getRepoDisplayName(repoUrl: string): string {
  const trimmed = repoUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return 'Imported Project'
  const lastSegment = trimmed.split(/[/\\]/).pop() ?? 'Imported Project'
  return lastSegment.replace(/\.git$/i, '') || 'Imported Project'
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function isComponentFile(pathValue: string): boolean {
  const normalized = normalizePath(pathValue)
  return (
    normalized.includes('/components/') &&
    /\.(tsx|jsx|vue|svelte)$/i.test(normalized)
  )
}

function isPageFile(pathValue: string): boolean {
  const normalized = normalizePath(pathValue)
  return (
    /\/app\/.*\/page\.(tsx|jsx|ts|js)$/i.test(normalized) ||
    /\/pages\/.*\.(tsx|jsx|ts|js|vue|svelte|astro|md|mdx)$/i.test(normalized) ||
    /\/src\/pages\/.*\.(tsx|jsx|ts|js|vue|svelte|astro|md|mdx)$/i.test(normalized) ||
    /\/src\/routes\/.*\/\+page\.svelte$/i.test(normalized) ||
    /\/app\/routes\/.*\.(tsx|jsx|ts|js)$/i.test(normalized)
  )
}

function isRepoIntegrationProvider(provider: string): provider is RepoIntegrationProvider {
  return provider === 'github' || provider === 'gitlab'
}

function inferRepoProviderFromUrl(repoUrl: string): RepoIntegrationProvider | null {
  const normalized = repoUrl.trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('gitlab.com') || normalized.includes('/gitlab/')) {
    return 'gitlab'
  }
  if (normalized.includes('github.com') || normalized.includes('/github/')) {
    return 'github'
  }
  return null
}

function buildImportPreflightIssueMessage(
  _issues: Array<{ path: string; reason: string }>,
  _truncated?: boolean
): string {
  return 'Some iCloud files are not available locally. Download them in Finder first.'
}

function buildDeferredTeamSetup(team: WizardTeamMember[]): WizardTeamMember[] {
  return team.filter((member) => !member.isCurrentUser)
}

async function installProjectDependenciesForImport(args: {
  projectPath: string
  onProgress?: (message: string) => void
}): Promise<{ success: true; installed: boolean } | { success: false; error: string }> {
  const runtimeApi = window.electronAPI?.runtime
  const dependenciesApi = window.electronAPI?.dependencies

  if (!runtimeApi?.getProjectCapabilities || !dependenciesApi?.run || !dependenciesApi?.onJobStatus) {
    return { success: true, installed: false }
  }

  const profile = await runtimeApi.getProjectCapabilities({ projectPath: args.projectPath })
  const evidenceFiles = new Set([
    ...(profile.evidence?.files ?? []),
    ...(profile.evidence?.lockfiles ?? []),
  ])

  const shouldInstallNodeDependencies =
    evidenceFiles.has('package.json') ||
    evidenceFiles.has('package-lock.json') ||
    evidenceFiles.has('pnpm-lock.yaml') ||
    evidenceFiles.has('yarn.lock') ||
    evidenceFiles.has('bun.lock') ||
    evidenceFiles.has('bun.lockb')

  if (!shouldInstallNodeDependencies) {
    return { success: true, installed: false }
  }

  args.onProgress?.('Installing dependencies...')

  const startResult = await dependenciesApi.run({
    projectPath: args.projectPath,
    action: 'install',
  })

  if (!startResult.success || !startResult.jobId) {
    return {
      success: false,
      error: startResult.error || 'Failed to start dependency installation.',
    }
  }

  return await new Promise((resolve) => {
    const unsubscribe = dependenciesApi.onJobStatus((payload) => {
      if (payload.projectPath !== args.projectPath || payload.job.id !== startResult.jobId) {
        return
      }

      const output = payload.job.stderr?.trim() || payload.job.stdout?.trim()
      if (output) {
        const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1)
        if (lastLine) {
          args.onProgress?.(`Installing dependencies... ${lastLine}`)
        }
      }

      if (payload.job.status === 'success') {
        unsubscribe?.()
        resolve({ success: true, installed: true })
        return
      }

      if (payload.job.status === 'error') {
        unsubscribe?.()
        resolve({
          success: false,
          error: payload.job.error || 'Dependency installation failed.',
        })
      }
    })
  })
}

export function NewProject() {
  const { user, logout, convexUserId } = useAuth()
  const {
    personalScoped: isPersonalWorkspace,
    convexOrganizationId: organizationId,
    includeTeamStep,
    canCreateProjects,
    canImportProjects,
    permissions,
  } = useProjectTargetScope()
  const navigate = useViewTransitionNavigate()
  const convex = useConvex()

  const wizard = useWizardState(organizationId, convexUserId ?? undefined, {
    includeTeamStep,
  })
  const workspaceSetupMode = getDefaultVersionControlSetupMode(isPersonalWorkspace)
  const [remoteRepositorySearch, setRemoteRepositorySearch] = useState('')
  const [remoteRepositoryRefreshNonce, setRemoteRepositoryRefreshNonce] = useState(0)
  const [isRemoteRepositoriesLoading, setIsRemoteRepositoriesLoading] = useState(false)

  // Conversation mode state (for prompt path) - stored locally until plan is selected
  const [isConversationMode, setIsConversationMode] = useState(false)
  const [conversationPromptSettings, setConversationPromptSettings] = useState<PromptSettings | null>(null)
  const [pendingPromptText, setPendingPromptText] = useState<string>('')

  // Repo import state
  const [importSyncState, setImportSyncState] = useState<'idle' | 'checking' | 'syncing' | 'ready' | 'error'>('idle')
  const [importSyncMessage, setImportSyncMessage] = useState<string>('')
  const [isScanning, setIsScanning] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const isImporting = importSyncState !== 'idle' && importSyncState !== 'error'

  // Convex mutation for creating project
  const createProject = useMutation(api.projects.create)
  const saveGeneratedPlan = useMutation(api.projects.saveGeneratedPlan)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const deleteProject = useMutation(api.projects.deleteProject)
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)
  const recordRepoAccessSyncResult = useMutation(api.projectRepoAccess.recordSyncResult)

  // Fetch organization members for the team step
  const orgMembersData = useQuery(
    api.organizations.getMembers,
    organizationId && convexUserId && permissions.includes('members:view')
      ? { orgId: organizationId, viewerUserId: convexUserId }
      : 'skip'
  )

  // Transform to OrgMember format
  const organizationMembers: OrgMember[] = (orgMembersData ?? []).map((m) => ({
    id: m._id,
    email: m.user?.email || '',
    firstName: m.user?.firstName,
    lastName: m.user?.lastName,
    profileImageUrl: m.user?.profileImageUrl,
    role: m.role,
  })).filter((m) => m.email) // Filter out members without email
  const profile = useQuery(
    api.users.getById,
    convexUserId ? { userId: convexUserId } : 'skip'
  )
  const organizationSettings = useQuery(
    api.organizations.get,
    organizationId ? { id: organizationId } : 'skip'
  )
  const { getConnection } = useWorkspaceSourceControl({
    route: '/projects/new',
    enabled: Boolean(organizationId && convexUserId),
  })
  const githubIntegration = getConnection('github')
  const gitlabIntegration = getConnection('gitlab')
  const connectedRepoProviders = useMemo(
    () => [
      ...(githubIntegration ? (['github'] as const) : []),
      ...(gitlabIntegration ? (['gitlab'] as const) : []),
    ],
    [githubIntegration, gitlabIntegration]
  )
  const preferredSourceControlProviders = useMemo(
    () => readSourceControlProviderPreferences(),
    []
  )
  const sourceControlProviderPreference = useMemo(
    () =>
      resolveSourceControlProviderPreference({
        userDefaultProvider: profile?.preferences?.sourceControlDefaultProvider,
        workspaceDefaultProvider: organizationSettings?.sourceControlSettings?.defaultProvider,
        preferredProviders: preferredSourceControlProviders,
        githubConnection: githubIntegration,
        gitlabConnection: gitlabIntegration,
      }),
    [
      gitlabIntegration,
      githubIntegration,
      organizationSettings?.sourceControlSettings?.defaultProvider,
      preferredSourceControlProviders,
      profile?.preferences?.sourceControlDefaultProvider,
    ]
  )
  const defaultSourceControlProvider = sourceControlProviderPreference.provider

  const {
    state,
    steps,
    currentStepDef,
    isFirstStep,
    canProceed,
    setPath,
    goToStep,
    nextStep,
    prevStep,
    updateSourceControl,
    addTeamMember,
    removeTeamMember,
    setOriginalPrompt,
    setRepoSource,
  } = wizard

  // Add current user as project manager when entering team step
  useEffect(() => {
    if (currentStepDef?.id === 'team' && state.team.length === 0 && user) {
      addTeamMember({
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
        role: 'project_manager',
        isCurrentUser: true,
        profileImageUrl: user.profileImageUrl,
      })
    }
  }, [currentStepDef?.id, state.team.length, user, addTeamMember])

  useEffect(() => {
    if (!isPersonalWorkspace || !user) {
      return
    }

    const currentUserEmail = user.email.trim().toLowerCase()
    const alreadyIncluded = state.team.some(
      (member) => member.email.trim().toLowerCase() === currentUserEmail
    )

    if (alreadyIncluded) {
      return
    }

    addTeamMember({
      email: user.email,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
      role: 'project_manager',
      isCurrentUser: true,
      profileImageUrl: user.profileImageUrl,
    })
  }, [addTeamMember, isPersonalWorkspace, state.team, user])

  useEffect(() => {
    if (state.sourceControl.setupMode === workspaceSetupMode) {
      return
    }

    updateSourceControl({
      setupMode: workspaceSetupMode,
    })
  }, [state.sourceControl.setupMode, updateSourceControl, workspaceSetupMode])

  const handleBack = () => {
    if (isFirstStep) {
      navigate('/projects')
    } else {
      prevStep()
    }
  }

  const handleNext = async () => {
    // For repo-source step, scan the repo before advancing
    if (currentStepDef?.id === 'repo-source' && state.repoSource?.repoUrl) {
      setIsScanning(true)
      try {
        const baseRepoSource = {
          ...state.repoSource,
          provider: state.repoSource.provider || 'github',
          branch: state.repoSource.branch || 'main',
        }

        let detectedStack: NonNullable<typeof state.repoSource.detectedStack> = {
          pageCount: 0,
          componentCount: 0,
        }

        if (baseRepoSource.provider === 'local') {
          const projectPath = baseRepoSource.repoUrl

          // Detect framework
          const frameworkInfo = await detectFramework(projectPath)

          // Detect styling, database, testing from package.json
          let styling: string | undefined
          let database: string | undefined
          let testingFramework: string | undefined

          try {
            const pkgResult = await window.electronAPI.project.readFile({
              projectPath,
              filePath: 'package.json',
            })

            if (pkgResult.success && pkgResult.content) {
              const pkg = JSON.parse(pkgResult.content)
              const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

              // Detect styling
              if (allDeps['tailwindcss']) styling = 'Tailwind CSS'
              else if (allDeps['@emotion/react'] || allDeps['@emotion/styled']) styling = 'Emotion'
              else if (allDeps['styled-components']) styling = 'Styled Components'
              else if (allDeps['@chakra-ui/react']) styling = 'Chakra UI'
              else if (allDeps['@mui/material']) styling = 'Material UI'

              // Detect database
              if (allDeps['@supabase/supabase-js']) database = 'Supabase'
              else if (allDeps['prisma'] || allDeps['@prisma/client']) database = 'Prisma'
              else if (allDeps['drizzle-orm']) database = 'Drizzle'
              else if (allDeps['firebase'] || allDeps['firebase-admin']) database = 'Firebase'
              else if (allDeps['mongoose']) database = 'MongoDB'
              else if (allDeps['convex']) database = 'Convex'

              // Detect testing
              if (allDeps['vitest']) testingFramework = 'Vitest'
              else if (allDeps['jest']) testingFramework = 'Jest'
              else if (allDeps['@testing-library/react']) testingFramework = 'Testing Library'
              else if (allDeps['cypress']) testingFramework = 'Cypress'
              else if (allDeps['playwright']) testingFramework = 'Playwright'
            }
          } catch {
            // Ignore package.json parse errors
          }

          // Count components
          let pageCount = 0
          let componentCount = 0
          try {
            const listResult = await window.electronAPI.project.listFiles({ projectPath })
            if (listResult.success && listResult.files) {
              for (const file of listResult.files) {
                if (isComponentFile(file.path)) componentCount++
                if (isPageFile(file.path)) pageCount++
              }
            }
          } catch {
            // Ignore count errors
          }

          detectedStack = {
            framework: frameworkInfo.framework,
            styling,
            database,
            testingFramework,
            pageCount,
            componentCount,
          }
        }

        // Update repo source with detected stack
        setRepoSource({ ...baseRepoSource, detectedStack })
        const currentUserEmail = user?.email?.trim().toLowerCase()
        if (
          user &&
          currentUserEmail &&
          !state.team.some((member) => member.email.trim().toLowerCase() === currentUserEmail)
        ) {
          addTeamMember({
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
            role: 'project_manager',
            isCurrentUser: true,
            profileImageUrl: user.profileImageUrl,
          })
        }
        setIsScanning(false)
        const reviewStepIndex = steps.findIndex((step) => step.id === 'review')
        if (reviewStepIndex >= 0) {
          goToStep(reviewStepIndex)
        } else {
          nextStep()
        }
      } catch (error) {
        console.error('Scan failed:', error)
        setIsScanning(false)
        // Still advance even if scan fails
        const reviewStepIndex = steps.findIndex((step) => step.id === 'review')
        if (reviewStepIndex >= 0) {
          goToStep(reviewStepIndex)
        } else {
          nextStep()
        }
      }
      return
    }

    nextStep()
  }

  const handleSelectPath = async (path: GuidedEntryChoice) => {
    setImportError(null)
    setImportSyncState('idle')
    setImportSyncMessage('')

    if (path === 'remote-repository') {
      const initialRemoteProvider = defaultSourceControlProvider ?? ''
      setRepoSource({
        provider: initialRemoteProvider,
        repoUrl: '',
        branch: 'main',
      })
      updateSourceControl({
        provider: initialRemoteProvider,
        defaultBranch: 'main',
        syncPolicy: 'auto',
        workingCopyMode: 'managed',
        setupMode: workspaceSetupMode,
      })
      setPath('repo')
      return
    }

    const result = await window.electronAPI.dialog.selectDirectory()
    if (!result.success || result.canceled || !result.path) {
      return
    }

    setRepoSource({
      provider: 'local',
      repoUrl: result.path,
      branch: 'main',
    })
    updateSourceControl({
      provider: 'local',
      defaultBranch: 'main',
      syncPolicy: 'manual',
      workingCopyMode: 'attached',
      setupMode: workspaceSetupMode,
    })
    setPath('repo')
  }

  const handlePromptSubmit = async (settings: PromptSettings, promptText: string) => {
    console.log('[NewProject] handlePromptSubmit received settings:', settings)
    // Don't create project yet - just start conversation mode
    // Project will be created when user selects a plan
    setOriginalPrompt(promptText)
    setPendingPromptText(promptText)
    setConversationPromptSettings(settings)
    setIsConversationMode(true)
  }

  const markCurrentUserRepoAccessGranted = async (args: {
    projectId: Id<'projects'>
    provider?: string
    repoUrl?: string | null
  }) => {
    if (!convexUserId) {
      return
    }

    const provider =
      args.provider === 'github' || args.provider === 'gitlab'
        ? args.provider
        : undefined
    const repoUrl = args.repoUrl?.trim()

    if (!provider || !repoUrl) {
      return
    }

    try {
      await recordRepoAccessSyncResult({
        projectId: args.projectId,
        actorUserId: convexUserId,
        provider,
        repoUrl,
        subjectType: 'member',
        memberUserId: convexUserId,
        role: 'project_manager',
        accessState: 'granted',
      })
    } catch (error) {
      console.warn('[NewProject] Failed to mark creator repository access as granted:', error)
    }
  }

  const resolvePlanSourceControl = (plan: PlanOption) => {
    const planProvider =
      plan.config.sourceControl?.provider === 'gitlab' ||
      plan.config.sourceControl?.provider === 'github'
        ? plan.config.sourceControl.provider
        : defaultSourceControlProvider ?? undefined

    return {
      visibility: 'private',
      mergeStrategy: 'squash',
      ...plan.config.sourceControl,
      ...(planProvider ? { provider: planProvider } : {}),
    }
  }

  const handlePlanSelected = async (plan: PlanOption) => {
    if (!organizationId || !convexUserId || !canCreateProjects) {
      console.error('Missing project creation scope or permission', {
        organizationId,
        convexUserId,
        canCreateProjects,
      })
      alert('Unable to create project. Please try again or refresh the page.')
      return
    }

    const webOnlyValidation = validateWebOnlyPlanConfig(plan.config)
    if (!webOnlyValidation.valid) {
      alert(`Current builder supports web projects only. ${webOnlyValidation.error ?? ''}`.trim())
      return
    }

    console.log('[NewProject] Creating project with promptSettings:', conversationPromptSettings)

    try {
      const normalizedSourceControl = resolvePlanSourceControl(plan)
      if (
        normalizedSourceControl.provider !== 'github' &&
        normalizedSourceControl.provider !== 'gitlab'
      ) {
        alert('Please tell the planner whether this project should use GitHub or GitLab, then try again.')
        return
      }

      // NOW create the project with the selected plan configuration
      const result = await createProject({
        organizationId,
        userId: convexUserId,
        name: plan.config.name || 'Untitled Project',
        creationPath: 'prompt',
        description: plan.config.description,
        audience: plan.config.audience,
        template: plan.config.template,
        targetPlatform: plan.config.targetPlatform,
        buildContract: plan.config.buildContract ?? getDefaultWebBuildContract(),
        stack: plan.config.stack,
        sourceControl: normalizedSourceControl,
        visuals: plan.config.visuals,
        originalPrompt: pendingPromptText,
        promptSettings: conversationPromptSettings ? {
          model: conversationPromptSettings.model,
          agentId: conversationPromptSettings.agentId,
          surface: conversationPromptSettings.surface,
          variantId: conversationPromptSettings.variantId,
          toolsEnabled: true,
          webSearchEnabled: true,
        } : undefined,
      })
      await markCurrentUserRepoAccessGranted({
        projectId: result.projectId,
        provider: normalizedSourceControl.provider,
        repoUrl: normalizedSourceControl.repoUrl,
      })

      const generatedPlan = normalizeGeneratedPlan(
        plan.config.generatedPlan ?? { pages: [], entities: [] }
      )
      await saveGeneratedPlan({
        projectId: result.projectId,
        userId: convexUserId,
        plan: generatedPlan,
        selectedPlanTier: plan.tier,
        targetPlatform: plan.config.targetPlatform,
        buildContract: plan.config.buildContract ?? getDefaultWebBuildContract(),
      })

      // Navigate to build page with the new project
      navigate(`/projects/${result.projectId}/build`)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  const handleEditStep = (stepIndex: number) => {
    goToStep(stepIndex)
  }

  // Handle repo import from ReviewStep button
  const handleImportProject = async () => {
    if (!organizationId || !convexUserId || !canImportProjects) {
      console.error('[Import] Missing import scope or permission', {
        organizationId,
        convexUserId,
        canImportProjects,
      })
      return
    }

    setImportError(null)
    setImportSyncState('checking')
    setImportSyncMessage('Preparing project...')

    const repoSource = state.repoSource
      ? {
          provider: state.repoSource.provider || 'github',
          repoUrl: state.repoSource.repoUrl,
          branch: state.repoSource.branch || 'main',
          detectedStack: state.repoSource.detectedStack,
        }
      : null

    if (!repoSource?.repoUrl) {
      setImportError('Please select a repository before importing.')
      setImportSyncState('error')
      setImportSyncMessage('Repository required')
      return
    }

    if (!repoSource.provider || !repoSource.branch) {
      setImportError('Repository provider and branch are required.')
      setImportSyncState('error')
      setImportSyncMessage('Repository details required')
      return
    }

    const repoName = getRepoDisplayName(repoSource.repoUrl)
    console.log('[Import] Starting import:', { repoName, repoSource })
    if (repoSource.provider === 'local') {
      const runImportPreflight = window.electronAPI.project.preflightImportSource
      if (typeof runImportPreflight === 'function') {
        setImportSyncMessage('Checking local files...')
        const preflightResult = await runImportPreflight({
          projectPath: repoSource.repoUrl,
          mode: 'raw',
        })

        if (!preflightResult.success) {
          const message = preflightResult.error || 'Unable to verify local source files'
          setImportError(message)
          setImportSyncState('error')
          setImportSyncMessage('Local check failed')
          return
        }

        const issues = preflightResult.issues ?? []
        if (issues.length > 0) {
          const message = buildImportPreflightIssueMessage(issues, preflightResult.truncated)
          setImportError(message)
          setImportSyncState('error')
          setImportSyncMessage('Files unavailable')
          return
        }
      } else {
        console.warn('[Import] preflightImportSource bridge unavailable; continuing without preflight')
      }
    }

    setImportSyncMessage('Creating project...')

    const sourceControlForImport = {
      provider: repoSource.provider,
      repoUrl: repoSource.provider === 'local' ? undefined : repoSource.repoUrl,
      defaultBranch: repoSource.branch,
      visibility: state.sourceControl.visibility,
      mergeStrategy: state.sourceControl.mergeStrategy,
      mergeQueue: state.sourceControl.mergeQueue,
      syncPolicy: state.sourceControl.syncPolicy === 'manual' ? 'manual' as const : 'auto' as const,
      workingCopyMode: state.sourceControl.workingCopyMode || (repoSource.provider === 'local' ? 'attached' as const : 'managed' as const),
      setupMode: state.sourceControl.setupMode ?? workspaceSetupMode,
    }

    let createdProjectId: Id<'projects'> | null = null
    let createdWorkspacePath: string | null = null
    let retainCreatedProject = false

    const cleanupPartialImport = async () => {
      const workspacePath = createdWorkspacePath
      createdWorkspacePath = null
      if (workspacePath) {
        try {
          const deleteLocalResult = await window.electronAPI.storage.deleteProject({
            projectPath: workspacePath,
          })
          if (!deleteLocalResult.success) {
            throw new Error(deleteLocalResult.error || 'Failed to remove local import workspace')
          }
        } catch (cleanupError) {
          console.warn('[Import] Failed to cleanup partially imported local workspace:', cleanupError)
        }
      }

      if (!createdProjectId) return
      try {
        await deleteProject({
          projectId: createdProjectId,
          userId: convexUserId,
          confirmName: repoName,
        })
        createdProjectId = null
      } catch (cleanupError) {
        console.warn('[Import] Failed to cleanup partially created project:', cleanupError)
      }
    }

    try {
      console.log('[Import] Calling createProject mutation...')
      const result = await createProject({
        organizationId,
        userId: convexUserId,
        name: repoName,
        creationPath: 'repo',
        sourceControl: sourceControlForImport,
        repoSource,
      })
      await markCurrentUserRepoAccessGranted({
        projectId: result.projectId,
        provider: sourceControlForImport.provider,
        repoUrl: sourceControlForImport.repoUrl,
      })
      createdProjectId = result.projectId
      console.log('[Import] Project created:', result)

      let importPath = repoSource.repoUrl

      if (repoSource.provider !== 'local') {
        let accessToken: string | undefined

        if (isRepoIntegrationProvider(repoSource.provider)) {
          try {
            const providerSession = await convex.action(
              api.sourceControl.issueWorkspaceProviderSession,
              {
                organizationId,
                userId: convexUserId,
                provider: repoSource.provider,
                purpose: 'git',
              }
            )

            accessToken = providerSession?.accessToken
          } catch (credentialError) {
            console.warn(
              `[Import] Failed to resolve ${repoSource.provider} source-control credentials:`,
              credentialError
            )
          }
        }

        if (!result.slug) {
          await cleanupPartialImport()
          setImportSyncState('error')
          setImportSyncMessage('Project created but no slug was returned.')
          setImportError('Project created but no slug was returned.')
          return
        }

        setImportSyncMessage('Cloning repository...')
        const cloneResult = await window.electronAPI.project.cloneRepository({
          slug: result.slug,
          repoUrl: repoSource.repoUrl,
          provider: repoSource.provider,
          branch: repoSource.branch,
          accessToken,
        })

        if (!cloneResult.success || !cloneResult.localPath) {
          await cleanupPartialImport()
          let cloneMessage = cloneResult.error || 'Failed to clone repository'
          if (
            isRepoIntegrationProvider(repoSource.provider) &&
            !accessToken
          ) {
            cloneMessage += ` If this repository is private, connect your ${repoSource.provider === 'github' ? 'GitHub' : 'GitLab'} source control and try again.`
          }
          setImportSyncState('error')
          setImportSyncMessage(cloneMessage)
          setImportError(cloneMessage)
          return
        }

        createdWorkspacePath = cloneResult.localPath
        importPath = cloneResult.localPath
        await updateMemberLocalPath({
          projectId: result.projectId,
          userId: convexUserId,
          localPath: importPath,
        })
        
        
      } else {
        setImportSyncMessage('Attaching repository...')
        importPath = repoSource.repoUrl
        await updateMemberLocalPath({
          projectId: result.projectId,
          userId: convexUserId,
          localPath: importPath,
        })
      }

      if (result.projectId) {
        setImportSyncState('syncing')
        let publishFailed = false

        const runtimePreflight = await ensureProjectRuntimeToolchains(importPath, (progress) => {
          setImportSyncMessage(progress.message)
        })
        if (!runtimePreflight.success) {
          const failedLabel = runtimePreflight.failedRuntime
            ? runtimeLabel(runtimePreflight.failedRuntime)
            : 'Required'
          const message = runtimePreflight.error || `${failedLabel} runtime is unavailable.`
          await cleanupPartialImport()
          setImportError(message)
          setImportSyncState('error')
          setImportSyncMessage(message)
          return
        }

        if (runtimePreflight.installed.length > 0) {
          setImportSyncMessage(`Installed runtimes: ${runtimePreflight.installed.map(runtimeLabel).join(', ')}`)
        }

        if (repoSource.provider !== 'local') {
          const dependencyInstall = await installProjectDependenciesForImport({
            projectPath: importPath,
            onProgress: (message) => {
              setImportSyncMessage(message)
            },
          })

          if (!dependencyInstall.success) {
            await cleanupPartialImport()
            setImportError(dependencyInstall.error)
            setImportSyncState('error')
            setImportSyncMessage(dependencyInstall.error)
            return
          }
        }

        try {
          await updateSyncStatus({
            projectId: result.projectId,
            userId: convexUserId,
            status: 'syncing',
          })
        } catch (syncStatusError) {
          console.warn('[Import] Failed to set sync status to syncing:', syncStatusError)
        }

        retainCreatedProject = true
        try {
          await updateSyncStatus({
            projectId: result.projectId,
            userId: convexUserId,
            status: 'synced',
          })
        } catch (gitImportError) {
          publishFailed = true
          const message = gitImportError instanceof Error ? gitImportError.message : 'Git import setup failed'
          console.warn('[Import] Import git setup failed:', message)
          try {
            await updateSyncStatus({
              projectId: result.projectId,
              userId: convexUserId,
              status: 'error',
              errorMessage: message,
            })
          } catch (syncStatusError) {
            console.warn('[Import] Failed to mark git import error state:', syncStatusError)
          }
          setImportError(message)
        }

        setImportSyncState('ready')
        setImportSyncMessage(publishFailed ? 'Opening project locally...' : 'Opening project...')
        setTimeout(() => {
          const targetPath = buildProjectPath(String(result.projectId), 'pages')
          const deferredTeamSetup = !publishFailed ? buildDeferredTeamSetup(state.team) : []
          logDeferredTeamSetupDebug('navigate_with_pending_team_setup', {
            projectId: String(result.projectId),
            targetPath,
            publishFailed,
            deferredTeamSetupCount: deferredTeamSetup.length,
            deferredTeamSetup: deferredTeamSetup.map((member) => ({
              email: member.email,
              role: member.role,
            })),
          })
          console.log('[Import] Navigating to:', targetPath)
          navigate(targetPath, {
            state: {
              syncMode: 'git',
              pendingTeamSetup: deferredTeamSetup.length > 0 ? deferredTeamSetup : undefined,
            },
          })
          setImportSyncState('idle')
          setImportSyncMessage('')
        }, 200)
      } else {
        console.error('[Import] No projectId returned from createProject')
        setImportSyncState('error')
        setImportSyncMessage('Project created but no project id was returned.')
        setImportError('Project created but no project id was returned.')
      }
    } catch (error) {
      if (!retainCreatedProject) {
        await cleanupPartialImport()
      }
      console.error('[Import] Failed to create project:', error)
      const message = error instanceof Error ? error.message : 'Failed to create project'
      setImportError(message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, ''))
      setImportSyncState('error')
      setImportSyncMessage('Import failed')
    }
  }

  // Render the current step content
  const renderStepContent = () => {
    // Conversation mode for prompt path (project not created yet)
    if (isConversationMode && conversationPromptSettings) {
      return (
        <WizardConversation
          initialPrompt={pendingPromptText}
          defaultSourceControlProvider={defaultSourceControlProvider}
          shouldAskForSourceControlProvider={sourceControlProviderPreference.shouldAskUser}
          availableSourceControlProviders={sourceControlProviderPreference.connectedProviders}
          promptSettings={conversationPromptSettings}
          onPlanSelected={handlePlanSelected}
          className="flex-1 h-full"
        />
      )
    }

    // Entry step (choosing path)
    if (!state.path || state.step === 0) {
      return (
        <EntryChoice
          onSelect={handleSelectPath}
          defaultSourceControlProvider={defaultSourceControlProvider}
          shouldAskForSourceControlProvider={sourceControlProviderPreference.shouldAskUser}
          promptValue={state.originalPrompt || ''}
          onPromptChange={setOriginalPrompt}
          onPromptSubmit={handlePromptSubmit}
          isSubmitting={state.isSaving}
        />
      )
    }

    // Path-specific steps
    switch (currentStepDef?.id) {
      case 'repo-source':
        return (
          <div
            className={cn(
              'flex-1 min-h-0 flex flex-col'
            )}
          >
            <RepoSourceStep
              repoSource={state.repoSource}
              onUpdate={updateRepoSourcePartial}
              onBrowseFolder={browseLocalRepoFolder}
              organizationId={organizationId}
              entryMode={state.repoSource?.provider === 'local' ? 'local' : 'remote'}
              connectedProviders={connectedRepoProviders}
              remoteRepositorySearchValue={remoteRepositorySearch}
              remoteRepositoryRefreshNonce={remoteRepositoryRefreshNonce}
              onRemoteRepositoriesLoadingChange={setIsRemoteRepositoriesLoading}
            />
          </div>
        )

      case 'team':
        return (
          <TeamStep
            team={state.team}
            onAddMember={addTeamMember}
            onRemoveMember={removeTeamMember}
            organizationMembers={organizationMembers}
            currentUserEmail={user?.email}
            allowEmailInvites={isPersonalWorkspace}
            onContinue={handleNext}
            canContinue={Boolean(canProceed)}
          />
        )

      case 'review': {
        return (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              "mx-auto w-full",
              state.path === 'repo' && "max-w-none"
            )}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className={cn("min-w-0 h-full")}>
                <ReviewStep
                  state={state}
                  organizationId={organizationId}
                  userId={convexUserId}
                  onEditStep={handleEditStep}
                  editStepIndexById={Object.fromEntries(steps.map((step, index) => [step.id, index]))}
                  onUpdateSourceControl={updateSourceControl}
                  onImport={state.path === 'repo' ? handleImportProject : undefined}
                  isImporting={isImporting}
                  importError={importError}
                  importSyncState={importSyncState}
                  importSyncMessage={importSyncMessage}
                  className="max-w-none mx-0"
                />
              </div>
            </div>
          </div>
        )
      }

      default:
        return null
    }
  }

  // Determine button text
  const nextButtonText = useMemo(() => {
    if (isScanning) return 'Analyzing...'
    return 'Next'
  }, [isScanning])

  const usesInlineContinueButton =
    currentStepDef?.id === 'repo-source' ||
    currentStepDef?.id === 'team' ||
    currentStepDef?.id === 'review'
  const showNextButton =
    state.path !== null &&
    state.step > 0 &&
    !isConversationMode &&
    !usesInlineContinueButton

  // Don't show navigation at all in conversation mode
  const showNavigation = state.step > 0 && !isConversationMode

  const totalWizardSteps = Math.max(1, steps.length - 1)
  const stepProgressValue = state.step > 0 ? Math.min(100, Math.round((state.step / totalWizardSteps) * 100)) : 0

  const headerContent = useMemo(() => {
    if (isConversationMode) {
      return (
        <div className="flex items-center">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            AI Planning
          </span>
        </div>
      )
    }

    if (state.step <= 0) return null
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Step {state.step}/{totalWizardSteps}
        </span>
        <span className="text-sm text-muted-foreground truncate max-w-[260px]">
          {steps[state.step]?.title || 'Configure project'}
        </span>
      </div>
    )
  }, [isConversationMode, state.step, steps, totalWizardSteps])

  const breadcrumbAddon = useMemo(() => {
    if (isConversationMode || state.step <= 0) return null
    return (
      <div className="w-28">
        <Progress value={stepProgressValue} className="h-1.5" />
      </div>
    )
  }, [isConversationMode, state.step, stepProgressValue])

  const updateRepoSourcePartial = (partial: Partial<NonNullable<typeof state.repoSource>>) => {
    const baseRepoSource = state.repoSource ?? {
      provider: 'local',
      repoUrl: '',
      branch: 'main',
    }
    const nextRepoSource = { ...baseRepoSource, ...partial }
    const inferredProvider =
      nextRepoSource.provider === 'github' || nextRepoSource.provider === 'gitlab'
        ? nextRepoSource.provider
        : inferRepoProviderFromUrl(nextRepoSource.repoUrl)
    if (
      nextRepoSource.provider !== 'local' &&
      (!nextRepoSource.provider || nextRepoSource.provider.trim().length === 0) &&
      inferredProvider
    ) {
      nextRepoSource.provider = inferredProvider
    }
    if (nextRepoSource.provider === 'local') {
      nextRepoSource.ownerLogin = undefined
      nextRepoSource.ownerAvatarUrl = undefined
      nextRepoSource.lastActivityAt = undefined
      nextRepoSource.sizeBytes = undefined
      nextRepoSource.starsCount = undefined
    }
    setRepoSource(nextRepoSource)
    updateSourceControl({
      provider: nextRepoSource.provider,
      defaultBranch: nextRepoSource.branch || state.sourceControl.defaultBranch || 'main',
      syncPolicy:
        nextRepoSource.provider === 'local'
          ? state.sourceControl.syncPolicy === 'auto'
            ? 'auto'
            : 'manual'
          : state.sourceControl.syncPolicy === 'manual'
            ? 'manual'
            : 'auto',
      workingCopyMode: nextRepoSource.provider === 'local' ? 'attached' : 'managed',
      setupMode: state.sourceControl.setupMode ?? workspaceSetupMode,
    })
  }

  const browseLocalRepoFolder = async () => {
    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result && result.path) {
        updateRepoSourcePartial({
          repoUrl: result.path,
          provider: 'local',
          branch: 'main',
          ownerLogin: undefined,
          ownerAvatarUrl: undefined,
        })
      }
    } catch (error) {
      console.error('[Import] Failed to select directory:', error)
    }
  }

  const isRepoSourceStep = state.path === 'repo' && currentStepDef?.id === 'repo-source'
  const isLocalFolderRepoSourceStep = isRepoSourceStep && state.repoSource?.provider === 'local'
  const isRemoteRepositorySourceStep = isRepoSourceStep && !isLocalFolderRepoSourceStep
  const repoSourceFloatingAction = isRepoSourceStep ? (
    <div className="fixed bottom-10 right-4 z-50">
      <Button
        type="button"
        onClick={handleNext}
        disabled={!canProceed || state.isSaving || isScanning}
        className="rounded-full shadow-none hover:shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      >
        {state.isSaving || isScanning ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
        Continue
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  ) : undefined

  const headerControls = (!showNavigation || isConversationMode || state.step <= 0) ? null : (
    <div className="flex items-center gap-2">
      {isRemoteRepositorySourceStep && (
        <>
          <div className="flex h-8 w-[240px] shrink-0 items-center gap-2 rounded-full border border-border/60 bg-secondary/70 px-3 shadow-none">
            <Search className="pointer-events-none h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={remoteRepositorySearch}
              onChange={(event) => {
                setRemoteRepositorySearch(event.target.value)
              }}
              placeholder="Search repositories"
              className="h-full rounded-none border-0 bg-transparent px-0 py-0 text-xs shadow-none ring-0 focus-visible:ring-0"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoteRepositoryRefreshNonce((value) => value + 1)}
                  disabled={isRemoteRepositoriesLoading}
                  aria-label="Refresh repositories"
                  className="h-7 w-7 rounded-full px-0 hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40"
                >
                  {isRemoteRepositoriesLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh repositories</TooltipContent>
          </Tooltip>
        </>
      )}
      {isLocalFolderRepoSourceStep && (
        <button
          type="button"
          onClick={browseLocalRepoFolder}
          className={cn(
            "shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
            "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15",
            "text-foreground/80 hover:text-foreground transition-colors",
            "focus-visible:ring-0 focus-visible:ring-offset-0"
          )}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 opacity-80" />
          Change folder
        </button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              disabled={state.isSaving || isScanning || isImporting}
              aria-label="Back"
              className="bg-transparent hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Back</TooltipContent>
      </Tooltip>
      {showNextButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                onClick={handleNext}
                variant="ghost"
                size="icon"
                disabled={!canProceed || state.isSaving || isScanning}
                aria-label={nextButtonText}
                className="bg-transparent hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40"
              >
                {state.isSaving || isScanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : currentStepDef?.id === 'review' ? (
                  <Rocket className="h-4 w-4" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{nextButtonText}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: 'New Project' },
      ]}
      header={headerControls || headerContent || undefined}
      breadcrumbAddon={breadcrumbAddon || undefined}
      footer={undefined}
      contentMode="fixed"
      hideInbox
      headerAbsolute={state.path === 'repo' && currentStepDef?.id === 'repo-source'}
    >
      <WizardLayout
        steps={steps}
        currentStep={state.step}
        onStepClick={goToStep}
        canNavigateToStep={(step) => step < state.step}
        title={isConversationMode ? 'AI Project Planning' : state.path ? 'New Project' : 'Create a New Project'}
        fullHeight={
          isConversationMode ||
          (state.path === 'repo' &&
            (currentStepDef?.id === 'review' || currentStepDef?.id === 'repo-source'))
        }
        preserveInsetInFullHeight={false}
        showInternalStepHeader={false}
      >
        {/* Step Content */}
        <div
          className={
            isConversationMode
              ? "flex-1 flex flex-col min-h-0"
              : state.step === 0
                ? "min-h-[300px]"
                : "flex-1 flex flex-col min-h-0"
          }
        >
          {renderStepContent()}
        </div>
      </WizardLayout>
      {repoSourceFloatingAction}
    </DashboardLayout>
  )
}
