import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import { ArrowLeft, ArrowRight, Rocket, Loader2 } from 'lucide-react'
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
import { useWizardState, type CreationPath } from '../hooks/useWizardState'
import { useMutation, useQuery, useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { normalizeGeneratedPlan } from '../lib/plan'
import { detectFramework, detectPackageManager } from '../utils/projectDetector'
import { scanForRoutes } from '../utils/routeScanner'
import { computeSyncPlan, hasSyncOperations } from '@/lib/sync/syncEngine'
import { executeSyncPlan } from '@/lib/sync/syncExecutor'
import type { SyncExecutorResult } from '@/lib/sync/syncExecutor'
import { saveLocalSyncHistory } from '@/lib/sync/syncHistory'
import type { CloudFileEntry, LocalFileEntry } from '@/lib/sync/types'

export function NewProject() {
  const { user, logout, convexUserId, currentOrganization } = useAuth()
  const navigate = useNavigate()
  const convex = useConvex()

  // Get Convex org ID from currentOrganization (populated after Convex sync)
  const organizationId = currentOrganization?.convexOrgId as Id<"organizations"> | undefined

  const wizard = useWizardState(organizationId, convexUserId ?? undefined)

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

  // Convex mutation for creating project
  const createProject = useMutation(api.projects.create)
  const saveGeneratedPlan = useMutation(api.projects.saveGeneratedPlan)
  const generateUploadUrl = useMutation(api.projectFiles.generateUploadUrl)
  const saveFilesMutation = useMutation(api.projectFiles.saveFiles)
  const markFilesDeletedMutation = useMutation(api.projectFiles.markFilesDeleted)
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

  const handleBack = () => {
    if (isFirstStep) {
      navigate('/projects')
    } else {
      prevStep()
    }
  }

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

          // Detect package manager
          await detectPackageManager(projectPath)

          // Scan for routes
          const routeInfo = await scanForRoutes(projectPath)

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
          let componentCount = 0
          try {
            const manifest = await window.electronAPI.sync.getLocalManifest({ projectPath })
            componentCount = manifest.manifest.filter(
              (f) => f.path.includes('/components/') && (f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
            ).length
          } catch {
            // Ignore count errors
          }

          detectedStack = {
            framework: frameworkInfo.framework,
            styling,
            database,
            testingFramework,
            pageCount: routeInfo.routes.length,
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

  const handleSelectPath = (path: CreationPath) => {
    setPath(path)
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
    if (!organizationId || !convexUserId) {
      console.error('Missing organizationId or convexUserId', { organizationId, convexUserId, currentOrganization })
      alert('Unable to create project. Please try again or refresh the page.')
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
        stack: plan.config.stack,
        sourceControl: plan.config.sourceControl,
        visuals: plan.config.visuals,
        originalPrompt: pendingPromptText,
        promptSettings: conversationPromptSettings ? {
          model: conversationPromptSettings.model,
          agentType: conversationPromptSettings.agentType,
          reasoningDepth: conversationPromptSettings.reasoningDepth,
          toolsEnabled: true,
          webSearchEnabled: true,
          thinkingEffort: conversationPromptSettings.thinkingEffort,
        } : undefined,
      })

      const generatedPlan = normalizeGeneratedPlan(
        plan.config.generatedPlan ?? { pages: [], entities: [] }
      )
      await saveGeneratedPlan({
        projectId: result.projectId,
        plan: generatedPlan,
        selectedPlanTier: plan.tier,
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

  const runInitialLocalSync = async (
    projectId: Id<"projects">,
    projectPath: string
  ): Promise<SyncExecutorResult> => {
    if (!convexUserId) {
      throw new Error('Missing user for sync')
    }

    setImportSyncState('checking')
    setImportSyncMessage('Checking files...')

    const [localResult, cloudManifest] = await Promise.all([
      window.electronAPI.sync.getLocalManifest({ projectPath }),
      convex.query(api.projectFiles.getManifestForProject, { projectId }),
    ])

    const localFiles: LocalFileEntry[] = localResult.manifest
    const cloudFiles: CloudFileEntry[] = cloudManifest.map((f) => ({
      _id: f._id,
      path: f.path,
      hash: f.hash,
      size: f.size,
      version: f.version,
      storageId: f.storageId,
      uploadedAt: f.uploadedAt,
    }))

    const plan = computeSyncPlan(localFiles, cloudFiles, undefined)

    if (!hasSyncOperations(plan)) {
      const now = Date.now()
      saveLocalSyncHistory(projectId, {
        lastSyncAt: now,
        cloudPathsAtLastSync: cloudFiles.map((f) => f.path),
      })
      return {
        success: true,
        downloadedCount: 0,
        uploadedCount: 0,
        deletedCount: 0,
        mergedCount: 0,
      }
    }

    setImportSyncState('syncing')
    setImportSyncMessage('Syncing files...')

    await updateSyncStatus({
      projectId,
      userId: convexUserId,
      status: 'syncing',
    })

    const result = await executeSyncPlan(plan, {
      projectId,
      userId: convexUserId,
      projectPath,
      onProgress: (progress) => {
        if (progress.message) {
          setImportSyncMessage(progress.message)
        }
      },
      generateUploadUrl: () => generateUploadUrl({ projectId }),
      saveFiles: (args) => saveFilesMutation(args),
      markFilesDeleted: (args) => markFilesDeletedMutation(args),
      getStorageUrl: async (storageId) => {
        try {
          return await convex.query(api.projectFiles.getFileUrl, { storageId })
        } catch {
          return null
        }
      },
    })

    await updateSyncStatus({
      projectId,
      userId: convexUserId,
      status: result.success ? 'synced' : 'error',
      errorMessage: result.error,
    })

    if (result.success) {
      const now = Date.now()
      const cloudPaths = new Set(cloudFiles.map((f) => f.path))
      for (const op of plan.uploads) cloudPaths.add(op.path)
      for (const op of plan.cloudDeletes) cloudPaths.delete(op.path)
      for (const op of plan.autoMerged ?? []) cloudPaths.add(op.path)
      saveLocalSyncHistory(projectId, {
        lastSyncAt: now,
        cloudPathsAtLastSync: cloudPaths,
      })
    }

    return result
  }

  // Handle repo import from ReviewStep button
  const handleImportProject = async () => {
    if (!organizationId || !convexUserId) {
      console.error('[Import] Missing organizationId or convexUserId', { organizationId, convexUserId })
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

    const repoName = repoSource.repoUrl.split(/[/\\]/).pop() || 'Imported Project'
    console.log('[Import] Starting import:', { repoName, repoSource })
    setImportSyncMessage('Creating project...')

    try {
      console.log('[Import] Calling createProject mutation...')
      const result = await createProject({
        organizationId,
        userId: convexUserId,
        name: repoName,
        creationPath: 'repo',
        repoSource,
      })
      console.log('[Import] Project created:', result)

      if (repoSource.provider === 'local') {
        try {
          const syncResult = await runInitialLocalSync(result.projectId, repoSource.repoUrl)
          if (!syncResult.success) {
            const syncMessage = syncResult.error ?? 'Initial sync failed'
            setImportSyncState('error')
            setImportSyncMessage(syncMessage)
            setImportError(syncMessage)
            return
          }
        } catch (syncError) {
          const syncMessage =
            syncError instanceof Error ? syncError.message : 'Initial sync failed'
          setImportSyncState('error')
          setImportSyncMessage(syncMessage)
          setImportError(syncMessage)
          return
        }
      }

      if (result.slug) {
        setImportSyncState('ready')
        setImportSyncMessage('Opening project...')
        setTimeout(() => {
          console.log('[Import] Navigating to:', `/projects/${result.slug}`)
          navigate(`/projects/${result.slug}`)
          setImportSyncState('idle')
          setImportSyncMessage('')
        }, 200)
      } else {
        console.error('[Import] No slug returned from createProject')
        setImportSyncState('error')
        setImportSyncMessage('Project created but no slug was returned.')
        setImportError('Project created but no slug was returned.')
      }
    } catch (error) {
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
          />
        )

      case 'review':
        return (
          <ReviewStep
            state={state}
            onEditStep={handleEditStep}
            onImport={state.path === 'repo' ? handleImportProject : undefined}
            isImporting={isImporting}
            importError={importError}
            importSyncState={importSyncState}
            importSyncMessage={importSyncMessage}
          />
        )

      case 'prompt':
        return (
          <PromptInput
            value={state.originalPrompt || ''}
            onChange={setOriginalPrompt}
            reviewBeforeBuild={reviewBeforeBuild}
            setReviewBeforeBuild={setReviewBeforeBuild}
            customizeTeam={customizeTeam}
            setCustomizeTeam={setCustomizeTeam}
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
          <RepoSourceStep
            repoSource={state.repoSource}
            onUpdate={(partial) => {
              const baseRepoSource = state.repoSource ?? {
                provider: 'github',
                repoUrl: '',
                branch: 'main',
              }
              setRepoSource({ ...baseRepoSource, ...partial })
            }}
          />
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

  // Navigation Footer
  const footerContent = showNavigation ? (
    <div className="flex items-center justify-between py-3 px-6 md:px-8 max-w-7xl mx-auto w-full">
      <Button variant="outline" size="sm" onClick={handleBack} className="gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      {showNextButton && (
        <Button
          onClick={handleNext}
          size="sm"
          disabled={!canProceed || state.isSaving || isScanning}
          className="gap-2"
        >
          {state.isSaving || isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : currentStepDef?.id === 'review' || currentStepDef?.id === 'prompt' || currentStepDef?.id === 'quick-review' ? (
            <Rocket className="h-4 w-4" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {nextButtonText}
        </Button>
      )}
    </div>
  ) : null

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: 'New Project' },
      ]}
      footer={footerContent}
    >
      <WizardLayout
        steps={steps}
        currentStep={state.step}
        onStepClick={goToStep}
        canNavigateToStep={(step) => step < state.step}
        title={isConversationMode ? 'AI Project Planning' : state.path ? 'New Project' : 'Create a New Project'}
        fullHeight={isConversationMode}
      >
        {/* Step Content */}
        <div className={isConversationMode ? "flex-1 flex flex-col min-h-0" : "min-h-[300px]"}>
          {renderStepContent()}
        </div>
      </WizardLayout>
    </DashboardLayout>
  )
}
