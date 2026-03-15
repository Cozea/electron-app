import { useCallback, useEffect, useMemo, useState } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useAuth } from '../contexts/AuthContext'
import { useProjectTargetScope } from '@/hooks/useProjectTargetScope'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Rocket, Loader2 } from 'lucide-react'
import type { Id } from '../../convex/_generated/dataModel'

import {
  WizardLayout,
  EntryChoice,
  IntentStep,
  TemplateStep,
  StackStep,
  SourceControlStep,
  VisualsStep,
  TeamStep,
  ReviewStep,
  PromptInput,
  WizardConversation,
  RepoSourceStep,
  type PromptSettings,
  type PlanOption,
  type OrgMember,
} from '../components/wizard'
import { useWizardState, type CreationPath, type WizardTeamMember } from '../hooks/useWizardState'
import { useMutation, useQuery, useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { getDefaultWebBuildContract, normalizeGeneratedPlan, validateWebOnlyPlanConfig } from '../lib/plan'
import {
  detectFramework,
  detectPackageManager,
  getInstallCommand,
  getLegacyPeerDepsInstallCommand,
  checkDependenciesInstalled,
  hasPackageJson,
} from '../utils/projectDetector'
import { useTerminalStore, useTerminalActions } from '@/stores/useTerminalStore'
import { TerminalInstance } from '@/features/projects/components/TerminalInstance'
import { cn } from '@/lib/utils'
import { ensureProjectRuntimeToolchains, runtimeLabel } from '@/lib/runtime/projectRuntimePreflight'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { publishWorkspaceToCozeaGit } from '@/lib/git/publishWorkspaceToCozeaGit'
import { logDeferredTeamSetupDebug } from '@/lib/projects/deferredTeamSetupDebug'
import {
  buildImportTerminalCommand,
  parseImportTerminalCompletionCode,
  type ImportTerminalPlatform,
} from '@/lib/importTerminalCommand'

type RepoIntegrationProvider = 'github' | 'gitlab'

const INSTALL_TIMEOUT_MS = 12 * 60 * 1000

function isWindowsClient(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platformHint = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
  return /win/i.test(platformHint)
}

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

function buildImportPreflightIssueMessage(
  _issues: Array<{ path: string; reason: string }>,
  _truncated?: boolean
): string {
  return 'Some iCloud files are not available locally. Download them in Finder first.'
}

function buildDeferredTeamSetup(team: WizardTeamMember[]): WizardTeamMember[] {
  return team.filter((member) => !member.isCurrentUser)
}

export function NewProject() {
  const { user, logout, convexUserId } = useAuth()
  const {
    personalScoped: isPersonalWorkspace,
    convexOrganizationId: organizationId,
    includeTeamStep,
    canCreateProjects,
    canImportProjects,
  } = useProjectTargetScope()
  const navigate = useViewTransitionNavigate()
  const convex = useConvex()

  const wizard = useWizardState(organizationId, convexUserId ?? undefined, {
    includeTeamStep,
  })

  // Prompt path options
  const [reviewBeforeBuild, setReviewBeforeBuild] = useState(true)
  const [customizeTeam, setCustomizeTeam] = useState(false)

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
  const [importTerminalId, setImportTerminalId] = useState<string | null>(null)
  const importTerminal = useTerminalStore((store) =>
    importTerminalId ? store.terminals[importTerminalId] ?? null : null
  )
  const {
    addTerminal,
    removeTerminal,
    setActiveTerminal,
    updateTerminalStatus,
  } = useTerminalActions()

  // Convex mutation for creating project
  const createProject = useMutation(api.projects.create)
  const saveGeneratedPlan = useMutation(api.projects.saveGeneratedPlan)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const deleteProject = useMutation(api.projects.deleteProject)
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)

  // Fetch organization members for the team step
  const orgMembersData = useQuery(
    api.organizations.getMembers,
    organizationId ? { orgId: organizationId } : 'skip'
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
    updateIntent,
    setTemplate,
    updateStack,
    updateSourceControl,
    addTeamMember,
    removeTeamMember,
    setOriginalPrompt,
    setRepoSource,
    createOrUpdateProject,
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

  const handleBack = () => {
    if (isFirstStep) {
      navigate('/projects')
    } else {
      prevStep()
    }
  }

  const runTerminalCommand = useCallback(
    async (projectPath: string, command: string): Promise<{ success: boolean; error?: string }> => {
      const platform: ImportTerminalPlatform = isWindowsClient() ? 'windows' : 'posix'
      const profiles = await window.electronAPI.terminal.getProfiles().catch(() => [])
      const commandPlan = buildImportTerminalCommand(command, platform, profiles)

      const createResult = await window.electronAPI.terminal.create({
        projectPath,
        profileId: commandPlan.profileId,
        cwd: projectPath,
        cols: 100,
        rows: 30,
      })

      if (!createResult.success || !createResult.terminalId) {
        return { success: false, error: createResult.error || 'Failed to create terminal session' }
      }

      const terminalId = createResult.terminalId
      addTerminal({
        id: terminalId,
        profileId: 'task',
        profileName: 'Import Setup',
        title: 'Import Setup',
        projectPath,
        label: 'Import Setup',
        kind: 'task',
        command,
        nameSource: 'auto',
        status: 'starting',
        hasOutput: false,
      })
      setActiveTerminal(terminalId)
      setImportTerminalId(terminalId)

      return await new Promise((resolve) => {
        let settled = false
        let commandDispatchTimer: number | null = null
        let completionBuffer = ''
        let recentOutput = ''
        const buildTerminalFailureMessage = (fallback: string) => {
          const sanitizedOutput = recentOutput
            .replace(new RegExp(`${commandPlan.completionMarker}:\\d+`, 'g'), '')
            .trim()
          if (!sanitizedOutput) return fallback
          return sanitizedOutput.slice(-4000)
        }
        const cleanup = () => {
          if (settled) return
          settled = true
          unsubscribeOutput()
          unsubscribeExit()
          window.clearTimeout(timeoutId)
          if (commandDispatchTimer !== null) {
            window.clearTimeout(commandDispatchTimer)
            commandDispatchTimer = null
          }
        }

        const unsubscribeExit = window.electronAPI.terminal.onExit(({ terminalId: exitedTerminalId, exitCode }) => {
          if (exitedTerminalId !== terminalId || settled) return
          updateTerminalStatus(
            terminalId,
            exitCode === 0 ? 'exited' : 'error',
            exitCode ?? undefined
          )
          cleanup()
          resolve({
            success: exitCode === 0,
            error: exitCode === 0
              ? undefined
              : buildTerminalFailureMessage(`Command exited with code ${exitCode ?? 'unknown'}`),
          })
        })

        const unsubscribeOutput = window.electronAPI.terminal.onOutput(({ terminalId: outputTerminalId, data }) => {
          if (outputTerminalId !== terminalId || settled) return

          recentOutput = `${recentOutput}${data}`.slice(-8000)
          completionBuffer = `${completionBuffer}${data}`.slice(-512)
          const exitCode = parseImportTerminalCompletionCode(
            completionBuffer,
            commandPlan.completionMarker
          )
          if (exitCode === null) return

          updateTerminalStatus(
            terminalId,
            exitCode === 0 ? 'exited' : 'error',
            exitCode
          )
          cleanup()
          resolve({
            success: exitCode === 0,
            error: exitCode === 0
              ? undefined
              : buildTerminalFailureMessage(`Command exited with code ${exitCode}`),
          })
        })

        const timeoutId = window.setTimeout(() => {
          if (settled) return
          cleanup()
          void window.electronAPI.terminal.kill({ terminalId })
          updateTerminalStatus(terminalId, 'error')
          resolve({ success: false, error: 'Command timed out' })
        }, INSTALL_TIMEOUT_MS)

        commandDispatchTimer = window.setTimeout(() => {
          window.electronAPI.terminal.input({
            terminalId,
            data: `${commandPlan.commandLine}\r\n`,
          }).catch((error) => {
            if (settled) return
            updateTerminalStatus(terminalId, 'error')
            cleanup()
            resolve({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to send terminal input',
            })
          })
        }, 100)

        updateTerminalStatus(terminalId, 'running')
      })
    },
    [addTerminal, setActiveTerminal, updateTerminalStatus]
  )

  const preinstallDependencies = useCallback(async (projectPath: string) => {
    const hasPkg = await hasPackageJson(projectPath)
    if (!hasPkg) return

    const packageManager = await detectPackageManager(projectPath)
    const depsInstalled = await checkDependenciesInstalled(projectPath, packageManager)
    if (depsInstalled) return

    setImportSyncMessage(`Installing dependencies (${packageManager})...`)
    const installCommand = getInstallCommand(packageManager)
    const installResult = await runTerminalCommand(projectPath, installCommand)
    if (installResult.success) {
      return
    }

    const legacyPeerDepsCommand = getLegacyPeerDepsInstallCommand(packageManager)
    const installError = installResult.error || 'Dependency installation failed'
    const shouldRetryWithLegacyPeerDeps =
      Boolean(legacyPeerDepsCommand) &&
      /ERESOLVE|peer dep|peer dependency|unable to resolve dependency tree/i.test(installError)

    if (shouldRetryWithLegacyPeerDeps && legacyPeerDepsCommand) {
      setImportSyncMessage(`Retrying install with legacy peer deps (${packageManager})...`)
      const retryResult = await runTerminalCommand(projectPath, legacyPeerDepsCommand)
      if (retryResult.success) {
        return
      }
      throw new Error(retryResult.error || installError)
    }

    throw new Error(installError)
  }, [runTerminalCommand])

  const cleanupImportTerminal = useCallback(async () => {
    if (!importTerminalId) return

    try {
      const terminalStatus = importTerminal?.status
      if (terminalStatus === 'starting' || terminalStatus === 'running') {
        await window.electronAPI.terminal.kill({ terminalId: importTerminalId })
      }
    } catch {
      // Ignore terminal shutdown errors during import cleanup.
    } finally {
      removeTerminal(importTerminalId)
      setImportTerminalId(null)
    }
  }, [importTerminal?.status, importTerminalId, removeTerminal])

  const handleNext = async () => {
    // On the review step for fresh path, create project and go to build
    if (currentStepDef?.id === 'review' && state.path === 'fresh') {
      const projectId = await createOrUpdateProject()
      if (projectId) {
        navigate(`/projects/${projectId}/build`)
      }
      return
    }

    // For prompt path, create project and go to build
    if (currentStepDef?.id === 'prompt' || currentStepDef?.id === 'quick-review') {
      const projectId = await createOrUpdateProject()
      if (projectId) {
        navigate(`/projects/${projectId}/build`)
      }
      return
    }

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
        setIsScanning(false)
        nextStep()
      } catch (error) {
        console.error('Scan failed:', error)
        setIsScanning(false)
        // Still advance even if scan fails
        nextStep()
      }
      return
    }

    nextStep()
  }

  const handleSelectPath = async (path: CreationPath) => {
    if (path !== 'repo') {
      setPath(path)
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
        sourceControl: plan.config.sourceControl,
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
        ...state.repoSource,
        provider: state.repoSource.provider || 'github',
        branch: state.repoSource.branch || 'main',
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
          mode: 'relocation',
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
        repoSource,
      })
      createdProjectId = result.projectId
      console.log('[Import] Project created:', result)

      let importPath = repoSource.repoUrl

      if (repoSource.provider !== 'local') {
        let encryptedCredentials: string | undefined
        let keyId: string | undefined

        if (isRepoIntegrationProvider(repoSource.provider) && window.electronAPI?.integrations) {
          try {
            const [integrationCredentials, keyMetadata] = await Promise.all([
              convex.query(api.integrations.getEncryptedCredentials, {
                organizationId,
                provider: repoSource.provider,
              }),
              convex.query(api.integrations.getKeyMetadata, { organizationId }),
            ])

            if (integrationCredentials?.encryptedCredentials && keyMetadata?.keyId) {
              encryptedCredentials = integrationCredentials.encryptedCredentials
              keyId = keyMetadata.keyId
            }
          } catch (credentialError) {
            console.warn(
              `[Import] Failed to resolve ${repoSource.provider} integration credentials:`,
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
          encryptedCredentials,
          keyId,
        })

        if (!cloneResult.success || !cloneResult.localPath) {
          await cleanupPartialImport()
          let cloneMessage = cloneResult.error || 'Failed to clone repository'
          if (
            isRepoIntegrationProvider(repoSource.provider) &&
            !encryptedCredentials
          ) {
            cloneMessage += ` If this repository is private, connect your ${repoSource.provider === 'github' ? 'GitHub' : 'GitLab'} integration and try again.`
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
        if (!result.slug) {
          await cleanupPartialImport()
          setImportSyncState('error')
          setImportSyncMessage('Project created but no slug was returned.')
          setImportError('Project created but no slug was returned.')
          return
        }

        setImportSyncMessage('Relocating repository...')
        const createFolderResult = await window.electronAPI.project.createFolder({
          slug: result.slug,
          initGit: false,
        })
        if (!createFolderResult.success || !createFolderResult.localPath) {
          await cleanupPartialImport()
          const message = createFolderResult.error || 'Failed to prepare project workspace'
          setImportSyncState('error')
          setImportSyncMessage(message)
          setImportError(message)
          return
        }
        createdWorkspacePath = createFolderResult.localPath

        const copyResult = await window.electronAPI.project.copyDirectorySnapshot({
          sourcePath: repoSource.repoUrl,
          targetPath: createFolderResult.localPath,
          mode: 'relocation',
        })
        if (!copyResult.success) {
          await cleanupPartialImport()
          const message = copyResult.error || 'Failed to relocate local repository'
          setImportSyncState('error')
          setImportSyncMessage(message)
          setImportError(message)
          return
        }

        importPath = copyResult.copiedTo || createFolderResult.localPath
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

        try {
          await updateSyncStatus({
            projectId: result.projectId,
            userId: convexUserId,
            status: 'syncing',
          })
        } catch (syncStatusError) {
          console.warn('[Import] Failed to set sync status to syncing:', syncStatusError)
        }

        try {
          await preinstallDependencies(importPath)
        } catch (dependencyError) {
          const message = dependencyError instanceof Error ? dependencyError.message : 'Dependency installation failed'
          await cleanupPartialImport()
          setImportError(message)
          setImportSyncState('error')
          setImportSyncMessage('Import failed')
          return
        }

        retainCreatedProject = true
        try {
          await publishWorkspaceToCozeaGit({
            convex,
            project: {
              _id: result.projectId,
              slug: result.slug ?? repoName,
              organizationId,
              syncMode: 'git',
              gitRepository: {
                provider: repoSource.provider === 'local' ? 'cozea' : repoSource.provider,
                url: repoSource.repoUrl,
                defaultBranch: 'main',
              },
              sourceControl: {
                provider: repoSource.provider,
                repoUrl: repoSource.repoUrl,
              },
            },
            projectPath: importPath,
            userId: convexUserId,
            onProgress: (message) => {
              setImportSyncMessage(message)
            },
            updateMemberLocalPath,
          })

          await updateSyncStatus({
            projectId: result.projectId,
            userId: convexUserId,
            status: 'synced',
          })
        } catch (gitImportError) {
          publishFailed = true
          const message = gitImportError instanceof Error ? gitImportError.message : 'Git import sync failed'
          console.warn('[Import] Import publish to Cozea git failed:', message)
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
          const targetPath = buildProjectPath(String(result.projectId))
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
          void cleanupImportTerminal()
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
          promptValue={state.originalPrompt || ''}
          onPromptChange={setOriginalPrompt}
          onPromptSubmit={handlePromptSubmit}
          isSubmitting={state.isSaving}
        />
      )
    }

    // Path-specific steps
    switch (currentStepDef?.id) {
      case 'intent':
        return <IntentStep intent={state.intent} onUpdate={updateIntent} />

      case 'template':
        return <TemplateStep selected={state.template} onSelect={setTemplate} />

      case 'stack':
        return <StackStep stack={state.stack} onUpdate={updateStack} />

      case 'source':
        return <SourceControlStep sourceControl={state.sourceControl} onUpdate={updateSourceControl} />

      case 'visuals':
        return <VisualsStep visuals={state.visuals} onUpdate={wizard.updateVisuals} />

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
        const showImportTerminalPanel = Boolean(importTerminalId && importSyncState !== 'idle')
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
                  onEditStep={handleEditStep}
                  onImport={state.path === 'repo' ? handleImportProject : undefined}
                  isImporting={isImporting}
                  importError={importError}
                  importSyncState={importSyncState}
                  importSyncMessage={importSyncMessage}
                  fillHeight={state.path === 'repo'}
                  className="max-w-none mx-0"
                />
              </div>
            </div>

            {showImportTerminalPanel && importTerminalId && (
              <div className="mt-2 flex h-[280px] min-h-[200px] max-h-[36vh] flex-col overflow-hidden rounded-xl border border-border bg-content-surface">
                <div className="flex h-8 items-center justify-between border-b border-border px-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Import Terminal
                    </p>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <TerminalInstance
                    terminalId={importTerminalId}
                    className="h-full w-full [--terminal-panel-bg:var(--content-surface)]"
                    shouldAutoFocus={isImporting}
                  />
                </div>
              </div>
            )}
          </div>
        )
      }

      case 'prompt':
        return (
          <PromptInput
            value={state.originalPrompt || ''}
            onChange={setOriginalPrompt}
            reviewBeforeBuild={reviewBeforeBuild}
            setReviewBeforeBuild={setReviewBeforeBuild}
            customizeTeam={customizeTeam}
            setCustomizeTeam={setCustomizeTeam}
            allowCustomizeTeam={!isPersonalWorkspace}
          />
        )

      case 'quick-review':
        // For one-shot path, show a simplified review
        return (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-semibold">Ready to Generate</h2>
              <p className="text-muted-foreground">
                Your AI assistant will analyze your prompt and generate a complete project plan.
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-6">
              <h3 className="text-sm font-medium mb-2">Your prompt:</h3>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {state.originalPrompt}
              </p>
            </div>
          </div>
        )

      // Repo path steps
      case 'repo-source':
        return (
          <div
            className={cn(
              "flex-1 min-h-0 flex flex-col",
              // Local folder uses a split file tree + Monaco preview; remove WizardLayout padding
              // so the panes can truly fill the available vertical space.
              "-my-8"
            )}
          >
            <RepoSourceStep
              repoSource={state.repoSource}
              onUpdate={updateRepoSourcePartial}
              onBrowseFolder={browseLocalRepoFolder}
              onContinue={handleNext}
              canContinue={Boolean(canProceed)}
            />
          </div>
        )

      // Plan and Build steps redirect to dedicated pages
      case 'plan':
      case 'build':
        return null

      default:
        return null
    }
  }

  // Determine button text
  const nextButtonText = useMemo(() => {
    if (state.isSaving) return 'Saving...'
    if (isScanning) return 'Analyzing...'
    if (currentStepDef?.id === 'review') return 'Generate Plan'
    if (currentStepDef?.id === 'prompt' || currentStepDef?.id === 'quick-review') return 'Generate Project'
    return 'Next'
  }, [currentStepDef?.id, state.isSaving, isScanning])

  // Don't show Next button on entry step (path selection handles it), in conversation mode, or for repo review (button is in card)
  const isRepoReview = state.path === 'repo' && currentStepDef?.id === 'review'
  const showNextButton = state.path !== null && state.step > 0 && !['plan', 'build'].includes(currentStepDef?.id || '') && !isConversationMode && !isRepoReview

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
    setRepoSource({ ...baseRepoSource, ...partial })
  }

  const browseLocalRepoFolder = async () => {
    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result && result.path) {
        updateRepoSourcePartial({ repoUrl: result.path, provider: 'local', branch: 'main' })
      }
    } catch (error) {
      console.error('[Import] Failed to select directory:', error)
    }
  }

  const isRepoSourceStep = state.path === 'repo' && currentStepDef?.id === 'repo-source'

  const headerControls = (!showNavigation || isConversationMode || state.step <= 0) ? null : (
    <div className="flex items-center gap-2">
      {isRepoSourceStep && (
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
                ) : currentStepDef?.id === 'review' || currentStepDef?.id === 'prompt' || currentStepDef?.id === 'quick-review' ? (
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
    >
      <WizardLayout
        steps={steps}
        currentStep={state.step}
        onStepClick={goToStep}
        canNavigateToStep={(step) => step < state.step}
        title={isConversationMode ? 'AI Project Planning' : state.path ? 'New Project' : 'Create a New Project'}
        fullHeight={isConversationMode || (state.path === 'repo' && currentStepDef?.id === 'review')}
        preserveInsetInFullHeight={state.path === 'repo' && currentStepDef?.id === 'review'}
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
    </DashboardLayout>
  )
}
