import { useState, useCallback, useMemo } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { getDefaultWebBuildContract, normalizeGeneratedPlan, type BuildContract, type TargetPlatform } from '../lib/plan'
import type { Id } from '../../convex/_generated/dataModel'
import {
  Sparkles,
  FolderGit2,
  Users,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react'

// ============================================
// TYPES
// ============================================

export type CreationPath = 'repo' | 'prompt'
export type ProjectStatus = 'draft' | 'generating' | 'building' | 'active' | 'archived' | 'deleted'
export type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'

export interface WizardIntent {
  name: string
  description: string
  audience: string
  targetLaunchDate?: number
  successCriteria?: 'working_feature' | 'mvp_launch' | 'production_ready' | 'internal_tool'
}

export interface WizardStack {
  backend: string
  hosting: string
  aiProvider: string
}

export interface WizardSourceControl {
  provider: string
  repoUrl?: string
  defaultBranch?: string
  visibility: string
  mergeStrategy: string
  mergeQueue?: string
  syncPolicy?: 'auto' | 'manual'
  workingCopyMode?: 'managed' | 'attached'
  setupMode?: 'personal' | 'organization'
}

export interface WizardVisuals {
  uiLibrary: string
  vibeDescription: string
  colorPreset?: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl?: string
}

export interface WizardTeamMember {
  email: string
  name?: string
  role: ProjectRole
  isCurrentUser?: boolean
  profileImageUrl?: string | null
}

export interface WizardRepoSource {
  provider: string
  repoUrl: string
  branch: string
  ownerLogin?: string
  ownerAvatarUrl?: string
  lastActivityAt?: string
  sizeBytes?: number
  starsCount?: number
  detectedStack?: {
    framework?: string
    styling?: string
    database?: string
    testingFramework?: string
    pageCount?: number
    componentCount?: number
  }
}

export interface WizardPage {
  id: string
  name: string
  route: string
  type: string
  purpose?: string
  actions?: string[]
}

export interface WizardEntity {
  id: string
  name: string
  fields?: string[]
}

export interface WizardGeneratedPlan {
  pages: WizardPage[]
  entities: WizardEntity[]
}

export interface WizardPromptSettings {
  model: string
  agentId: 'plan' | 'build' | 'assistant_general' | 'assistant_project' | 'explore' | 'review'
  surface: 'wizard' | 'builder' | 'assistant_panel' | 'assistant_project'
  variantId?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  toolsEnabled: boolean
  webSearchEnabled: boolean
}

function dedupeTeamMembers(team: WizardTeamMember[]): WizardTeamMember[] {
  const byEmail = new Map<string, WizardTeamMember>()

  for (const member of team) {
    const normalizedEmail = member.email.trim().toLowerCase()
    if (!normalizedEmail) continue

    const existing = byEmail.get(normalizedEmail)
    if (!existing) {
      byEmail.set(normalizedEmail, member)
      continue
    }

    byEmail.set(normalizedEmail, {
      ...existing,
      ...member,
      email: existing.email || member.email,
      name: member.name ?? existing.name,
      role: member.role ?? existing.role,
      isCurrentUser: existing.isCurrentUser || member.isCurrentUser,
      profileImageUrl: member.profileImageUrl ?? existing.profileImageUrl,
    })
  }

  return Array.from(byEmail.values())
}

export interface WizardState {
  // Navigation
  path: CreationPath | null
  step: number
  projectId?: Id<"projects">

  // Step data
  intent: WizardIntent
  template: string
  stack: WizardStack
  sourceControl: WizardSourceControl
  visuals: WizardVisuals
  team: WizardTeamMember[]

  // Path-specific data
  repoSource?: WizardRepoSource
  originalPrompt?: string
  promptSettings?: WizardPromptSettings

  // Generated plan
  generatedPlan?: WizardGeneratedPlan
  targetPlatform: TargetPlatform
  buildContract: BuildContract

  // Build state
  isSaving: boolean
  isGenerating: boolean
  isBuilding: boolean
  error?: string
}

// ============================================
// STEP DEFINITIONS
// ============================================

export interface WizardStepDef {
  id: string
  title: string
  description: string
  icon: LucideIcon
}

export const ENTRY_STEPS: WizardStepDef[] = [
  { id: 'entry', title: 'Start', description: 'Choose how to create', icon: Sparkles },
]

export const REPO_STEPS: WizardStepDef[] = [
  { id: 'entry', title: 'Start', description: 'Choose how to create', icon: Sparkles },
  { id: 'repo-source', title: 'Source', description: 'Select repository', icon: FolderGit2 },
  { id: 'team', title: 'Team', description: 'Team & roles', icon: Users },
  { id: 'review', title: 'Review', description: 'Review & import', icon: ClipboardCheck },
]

function maybeFilterTeamStep(steps: WizardStepDef[], includeTeamStep: boolean): WizardStepDef[] {
  if (includeTeamStep) {
    return steps
  }

  return steps.filter((step) => step.id !== 'team')
}

// ============================================
// DEFAULT VALUES
// ============================================

const DEFAULT_INTENT: WizardIntent = {
  name: '',
  description: '',
  audience: '',
}

const DEFAULT_STACK: WizardStack = {
  backend: 'supabase',
  hosting: 'vercel',
  aiProvider: 'openai',
}

const DEFAULT_SOURCE_CONTROL: WizardSourceControl = {
  provider: 'github',
  defaultBranch: 'main',
  visibility: 'private',
  mergeStrategy: 'squash',
  syncPolicy: 'auto',
  workingCopyMode: 'managed',
  setupMode: 'personal',
}

const DEFAULT_VISUALS: WizardVisuals = {
  uiLibrary: 'shadcn',
  vibeDescription: '',
  primaryColor: '#6366f1',
  secondaryColor: '#1e40af',
  accentColor: '#60a5fa',
}

const DEFAULT_STATE: WizardState = {
  path: null,
  step: 0,
  intent: DEFAULT_INTENT,
  template: '',
  stack: DEFAULT_STACK,
  sourceControl: DEFAULT_SOURCE_CONTROL,
  visuals: DEFAULT_VISUALS,
  team: [],
  targetPlatform: 'web',
  buildContract: getDefaultWebBuildContract(),
  isSaving: false,
  isGenerating: false,
  isBuilding: false,
}

// ============================================
// HOOK
// ============================================

export function useWizardState(
  organizationId?: Id<"organizations">,
  userId?: Id<"users">,
  options?: { includeTeamStep?: boolean }
) {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE)
  const includeTeamStep = options?.includeTeamStep ?? true

  // Convex mutations
  const createProject = useMutation(api.projects.create)
  const updateProject = useMutation(api.projects.update)
  const updateWizardStep = useMutation(api.projects.updateWizardStep)
  const updateStatus = useMutation(api.projects.updateStatus)
  const saveGeneratedPlan = useMutation(api.projects.saveGeneratedPlan)
  const recordRepoAccessSyncResult = useMutation(api.projectRepoAccess.recordSyncResult)

  // Get current step definitions based on path
  const steps = useMemo(() => {
    switch (state.path) {
      case 'repo':
        return maybeFilterTeamStep(REPO_STEPS, includeTeamStep)
      default:
        return ENTRY_STEPS
    }
  }, [includeTeamStep, state.path])

  const currentStepDef = steps[state.step]
  const isFirstStep = state.step === 0
  const isLastStep = state.step === steps.length - 1
  const progress = ((state.step + 1) / steps.length) * 100

  // ============================================
  // NAVIGATION
  // ============================================

  const setPath = useCallback((path: CreationPath) => {
    setState((prev) => ({
      ...prev,
      path,
      step: 1, // Move to first step after entry
    }))
  }, [])

  const goToStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  const nextStep = useCallback(async () => {
    if (isLastStep) return

    // Save progress if we have a project
    if (state.projectId && userId) {
      try {
        await updateWizardStep({
          projectId: state.projectId,
          userId,
          step: state.step + 1,
        })
      } catch (e) {
        console.error('Failed to save wizard step:', e)
      }
    }

    setState((prev) => ({ ...prev, step: prev.step + 1 }))
  }, [isLastStep, state.projectId, state.step, updateWizardStep, userId])

  const prevStep = useCallback(() => {
    if (isFirstStep) return
    setState((prev) => ({ ...prev, step: prev.step - 1 }))
  }, [isFirstStep])

  // ============================================
  // DATA UPDATES
  // ============================================

  const updateIntent = useCallback((intent: Partial<WizardIntent>) => {
    setState((prev) => ({
      ...prev,
      intent: { ...prev.intent, ...intent },
    }))
  }, [])

  const setTemplate = useCallback((template: string) => {
    setState((prev) => ({ ...prev, template }))
  }, [])

  const updateStack = useCallback((stack: Partial<WizardStack>) => {
    setState((prev) => ({
      ...prev,
      stack: { ...prev.stack, ...stack },
    }))
  }, [])

  const updateSourceControl = useCallback((sourceControl: Partial<WizardSourceControl>) => {
    setState((prev) => ({
      ...prev,
      sourceControl: { ...prev.sourceControl, ...sourceControl },
    }))
  }, [])

  const updateVisuals = useCallback((visuals: Partial<WizardVisuals>) => {
    setState((prev) => ({
      ...prev,
      visuals: { ...prev.visuals, ...visuals },
    }))
  }, [])

  const setTeam = useCallback((team: WizardTeamMember[]) => {
    setState((prev) => ({ ...prev, team: dedupeTeamMembers(team) }))
  }, [])

  const addTeamMember = useCallback((member: WizardTeamMember) => {
    setState((prev) => ({
      ...prev,
      team: dedupeTeamMembers([...prev.team, member]),
    }))
  }, [])

  const removeTeamMember = useCallback((email: string) => {
    setState((prev) => ({
      ...prev,
      team: prev.team.filter((m) => m.email !== email),
    }))
  }, [])

  const setRepoSource = useCallback((repoSource: WizardRepoSource) => {
    setState((prev) => ({ ...prev, repoSource }))
  }, [])

  const setOriginalPrompt = useCallback((originalPrompt: string) => {
    setState((prev) => ({ ...prev, originalPrompt }))
  }, [])

  const setPromptSettings = useCallback((promptSettings: WizardPromptSettings) => {
    setState((prev) => ({ ...prev, promptSettings }))
  }, [])

  const setGeneratedPlan = useCallback((generatedPlan: WizardGeneratedPlan) => {
    setState((prev) => ({ ...prev, generatedPlan }))
  }, [])

  // ============================================
  // PROJECT PERSISTENCE
  // ============================================

  const createOrUpdateProject = useCallback(async (overrides?: {
    path?: CreationPath
    originalPrompt?: string
    promptSettings?: WizardPromptSettings
  }) => {
    if (!organizationId || !userId) {
      setState((prev) => ({ ...prev, error: 'Missing organization or user' }))
      return null
    }

    setState((prev) => ({ ...prev, isSaving: true, error: undefined }))

    // Use overrides if provided (to avoid race conditions with state updates)
    const effectivePath = overrides?.path ?? state.path
    const effectivePrompt = overrides?.originalPrompt ?? state.originalPrompt
    const effectiveSettings = overrides?.promptSettings ?? state.promptSettings

    try {
      if (state.projectId) {
        // Update existing project
        await updateProject({
          projectId: state.projectId,
          userId,
          name: state.intent.name,
          description: state.intent.description,
          audience: state.intent.audience,
          targetLaunchDate: state.intent.targetLaunchDate,
          template: state.template,
          stack: state.stack,
          sourceControl: state.sourceControl,
          visuals: state.visuals,
          targetPlatform: state.targetPlatform,
          buildContract: state.buildContract,
          originalPrompt: effectivePrompt,
          promptSettings: effectiveSettings,
        })
        return state.projectId
      } else {
        // Create new project with all wizard state fields
        const result = await createProject({
          organizationId,
          userId,
          name: state.intent.name || 'Untitled Project',
          creationPath: effectivePath || 'prompt',
          description: state.intent.description,
          audience: state.intent.audience || undefined,
          targetLaunchDate: state.intent.targetLaunchDate,
          template: state.template || undefined,
          targetPlatform: state.targetPlatform,
          buildContract: state.buildContract,
          stack: state.stack,
          sourceControl: state.sourceControl,
          visuals: state.visuals,
          originalPrompt: effectivePrompt,
          promptSettings: effectiveSettings,
          repoSource: state.repoSource
            ? {
                provider: state.repoSource.provider,
                repoUrl: state.repoSource.repoUrl,
                branch: state.repoSource.branch,
                detectedStack: state.repoSource.detectedStack,
              }
            : undefined,
          team: state.team,
        })
        const provider =
          state.sourceControl.provider === 'github' || state.sourceControl.provider === 'gitlab'
            ? state.sourceControl.provider
            : undefined
        const repoUrl =
          state.sourceControl.repoUrl?.trim() ||
          (state.repoSource?.provider !== 'local' ? state.repoSource?.repoUrl?.trim() : undefined)
        if (provider && repoUrl) {
          try {
            await recordRepoAccessSyncResult({
              projectId: result.projectId,
              actorUserId: userId,
              provider,
              repoUrl,
              subjectType: 'member',
              memberUserId: userId,
              role: 'project_manager',
              accessState: 'granted',
            })
          } catch (error) {
            console.warn('Failed to mark creator repository access as granted:', error)
          }
        }
        setState((prev) => ({ ...prev, projectId: result.projectId }))
        return result.projectId
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Failed to save project'
      setState((prev) => ({ ...prev, error }))
      return null
    } finally {
      setState((prev) => ({ ...prev, isSaving: false }))
    }
  }, [
    organizationId,
    userId,
    state.projectId,
    state.path,
    state.intent,
    state.template,
    state.targetPlatform,
    state.buildContract,
    state.stack,
    state.sourceControl,
    state.visuals,
    state.originalPrompt,
    state.promptSettings,
    state.repoSource,
    state.team,
    createProject,
    recordRepoAccessSyncResult,
    updateProject,
  ])

  const savePlan = useCallback(async () => {
    if (!state.projectId || !state.generatedPlan || !userId) return

    try {
      await saveGeneratedPlan({
        projectId: state.projectId,
        userId,
        plan: normalizeGeneratedPlan(state.generatedPlan),
      })
    } catch (e) {
      console.error('Failed to save plan:', e)
    }
  }, [state.projectId, state.generatedPlan, saveGeneratedPlan, userId])

  const setStatus = useCallback(async (status: ProjectStatus) => {
    if (!state.projectId || !userId) return

    try {
      await updateStatus({
        projectId: state.projectId,
        userId,
        status,
      })
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }, [state.projectId, updateStatus, userId])

  const startGenerating = useCallback(() => {
    setState((prev) => ({ ...prev, isGenerating: true }))
  }, [])

  const stopGenerating = useCallback(() => {
    setState((prev) => ({ ...prev, isGenerating: false }))
  }, [])

  const startBuilding = useCallback(() => {
    setState((prev) => ({ ...prev, isBuilding: true }))
  }, [])

  const stopBuilding = useCallback(() => {
    setState((prev) => ({ ...prev, isBuilding: false }))
  }, [])

  const reset = useCallback(() => {
    setState(DEFAULT_STATE)
  }, [])

  // ============================================
  // VALIDATION
  // ============================================

  const canProceed = useMemo(() => {
    if (!state.path) return true // Entry step always allows proceed

    switch (currentStepDef?.id) {
      case 'team':
        // Require at least one project manager
        return state.team.some((m) => m.role === 'project_manager')
      case 'review':
        return true
      case 'repo-source':
        return !!state.repoSource?.repoUrl
      default:
        return true
    }
  }, [state, currentStepDef])

  return {
    // State
    state,
    steps,
    currentStepDef,
    isFirstStep,
    isLastStep,
    progress,
    canProceed,

    // Navigation
    setPath,
    goToStep,
    nextStep,
    prevStep,

    // Data updates
    updateIntent,
    setTemplate,
    updateStack,
    updateSourceControl,
    updateVisuals,
    setTeam,
    addTeamMember,
    removeTeamMember,
    setRepoSource,
    setOriginalPrompt,
    setPromptSettings,
    setGeneratedPlan,

    // Persistence
    createOrUpdateProject,
    savePlan,
    setStatus,

    // Build state
    startGenerating,
    stopGenerating,
    startBuilding,
    stopBuilding,

    // Reset
    reset,
  }
}
