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
  type PromptSettings,
  type PlanOption,
} from '../components/wizard'
import { useWizardState, type CreationPath } from '../hooks/useWizardState'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { normalizeGeneratedPlan } from '../lib/plan'

export function NewProject() {
  const { user, logout, convexUserId, currentOrganization } = useAuth()
  const navigate = useNavigate()

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

  // Convex mutation for creating project
  const createProject = useMutation(api.projects.create)
  const saveGeneratedPlan = useMutation(api.projects.saveGeneratedPlan)

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
    // On the review step (before generate), create/update the project
    if (currentStepDef?.id === 'review') {
      const projectId = await createOrUpdateProject()
      if (projectId) {
        // Navigate to the build page for this project
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

    nextStep()
  }

  const handleSelectPath = (path: CreationPath) => {
    setPath(path)
  }

  const handlePromptSubmit = async (settings: PromptSettings, promptText: string) => {
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
          toolsEnabled: conversationPromptSettings.toolsEnabled,
          webSearchEnabled: conversationPromptSettings.webSearchEnabled,
          thinkingEffort: conversationPromptSettings.thinkingEffort,
          providerOptions: conversationPromptSettings.providerOptions as Record<string, unknown> | undefined,
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
            currentUserEmail={user?.email || ''}
            onAddMember={addTeamMember}
            onRemoveMember={removeTeamMember}
          />
        )

      case 'review':
        return <ReviewStep state={state} onEditStep={handleEditStep} />

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

      // Repo path steps (not yet implemented)
      case 'repo-source':
      case 'repo-scan':
        return (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              Repository import coming soon...
            </p>
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
    if (currentStepDef?.id === 'review') return 'Generate Plan'
    if (currentStepDef?.id === 'prompt' || currentStepDef?.id === 'quick-review') return 'Generate Project'
    return 'Next'
  }, [currentStepDef?.id, state.isSaving])

  // Don't show Next button on entry step (path selection handles it) or in conversation mode
  const showNextButton = state.path !== null && state.step > 0 && !['plan', 'build'].includes(currentStepDef?.id || '') && !isConversationMode

  // Don't show navigation at all in conversation mode
  const showNavigation = state.step > 0 && !isConversationMode

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: 'New Project' },
      ]}
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

        {/* Navigation - hidden on entry step and in conversation mode */}
        {showNavigation && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <Button variant="outline" onClick={handleBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {showNextButton && (
            <Button
              onClick={handleNext}
              disabled={!canProceed || state.isSaving}
              className="gap-2"
            >
              {state.isSaving ? (
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
        )}
      </WizardLayout>
    </DashboardLayout>
  )
}
