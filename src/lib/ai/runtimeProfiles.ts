export type AgentId =
  | 'plan'
  | 'build'
  | 'assistant_general'
  | 'assistant_project'
  | 'explore'
  | 'review'

export type AISurface =
  | 'wizard'
  | 'builder'
  | 'assistant_panel'
  | 'assistant_project'

export type VariantId =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type RuntimeProvider = 'anthropic' | 'openai' | 'google' | 'xai'

export interface RuntimeModelCapabilities {
  supportsExtendedThinking?: boolean
  reasoningType?: 'effort' | 'budget' | 'level' | 'none' | string
  reasoningRange?: unknown
  supportsEffortParameter?: boolean
}

export interface AgentProfileDefinition {
  id: AgentId
  label: string
  description: string
  requiresProjectContext: boolean
  autoApproveLocalTools: boolean
  localToolPolicy: 'none' | 'read' | 'review' | 'project_full' | 'builder_full'
  allowWebSearch: boolean
}

export const AGENT_PROFILES: Record<AgentId, AgentProfileDefinition> = {
  plan: {
    id: 'plan',
    label: 'Plan',
    description: 'Planning/spec generation',
    requiresProjectContext: false,
    autoApproveLocalTools: false,
    localToolPolicy: 'none',
    allowWebSearch: true,
  },
  build: {
    id: 'build',
    label: 'Build',
    description: 'Implementation and execution',
    requiresProjectContext: true,
    autoApproveLocalTools: true,
    localToolPolicy: 'builder_full',
    allowWebSearch: true,
  },
  assistant_general: {
    id: 'assistant_general',
    label: 'Assistant',
    description: 'General help outside project context',
    requiresProjectContext: false,
    autoApproveLocalTools: false,
    localToolPolicy: 'none',
    allowWebSearch: false,
  },
  assistant_project: {
    id: 'assistant_project',
    label: 'Project Assistant',
    description: 'Project-scoped coding help',
    requiresProjectContext: true,
    autoApproveLocalTools: false,
    localToolPolicy: 'project_full',
    allowWebSearch: false,
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    description: 'Read/search codebase exploration',
    requiresProjectContext: true,
    autoApproveLocalTools: false,
    localToolPolicy: 'read',
    allowWebSearch: false,
  },
  review: {
    id: 'review',
    label: 'Review',
    description: 'Code review and diagnostics',
    requiresProjectContext: true,
    autoApproveLocalTools: false,
    localToolPolicy: 'review',
    allowWebSearch: false,
  },
}

export const DEFAULT_AGENT_BY_SURFACE: Record<AISurface, AgentId> = {
  wizard: 'plan',
  builder: 'build',
  assistant_panel: 'assistant_general',
  assistant_project: 'assistant_project',
}

export interface RuntimeVariantDefinition {
  id: VariantId
  label: string
}

export const VARIANT_DEFINITIONS: Record<VariantId, RuntimeVariantDefinition> = {
  none: { id: 'none', label: 'None' },
  minimal: { id: 'minimal', label: 'Minimal' },
  low: { id: 'low', label: 'Low' },
  medium: { id: 'medium', label: 'Medium' },
  high: { id: 'high', label: 'High' },
  xhigh: { id: 'xhigh', label: 'X High' },
  max: { id: 'max', label: 'Max' },
}

export const DEFAULT_VARIANT_ID: VariantId = 'medium'

const KNOWN_VARIANTS: VariantId[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const READ_LOCAL_TOOLS = new Set([
  'read',
  'list',
  'glob',
  'grep',
])

const REVIEW_DIAGNOSTIC_TOOLS = new Set([
  'verify_build',
])

function isVariantId(value: unknown): value is VariantId {
  return typeof value === 'string' && KNOWN_VARIANTS.includes(value as VariantId)
}

function variantsFromReasoningRange(range: unknown): VariantId[] {
  if (!Array.isArray(range)) return []

  const normalized = range
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value): value is VariantId => isVariantId(value))

  return Array.from(new Set(normalized))
}

export function getSupportedVariantsForModel(
  args: {
    modelId: string
    provider?: RuntimeProvider
    capabilities: RuntimeModelCapabilities | null | undefined
  }
): VariantId[] {
  const { provider, capabilities } = args

  if (!capabilities || capabilities.reasoningType === 'none') {
    return [DEFAULT_VARIANT_ID]
  }

  const modelDeclaredVariants = variantsFromReasoningRange(capabilities.reasoningRange)
  if (modelDeclaredVariants.length > 0) {
    return modelDeclaredVariants
  }

  if (provider === 'anthropic') {
    if (!capabilities.supportsExtendedThinking) {
      return [DEFAULT_VARIANT_ID]
    }
    if (capabilities.supportsEffortParameter) {
      return ['low', 'medium', 'high', 'max']
    }
    return ['high', 'max']
  }

  if (provider === 'google') {
    if (capabilities.reasoningType === 'level') {
      return ['low', 'high']
    }
    if (capabilities.reasoningType === 'budget') {
      return ['high', 'max']
    }
    return [DEFAULT_VARIANT_ID]
  }

  if (capabilities.reasoningType === 'effort') {
    return ['low', 'medium', 'high']
  }
  if (capabilities.reasoningType === 'level') {
    return ['low', 'high']
  }
  if (capabilities.reasoningType === 'budget') {
    return ['high', 'max']
  }
  return [DEFAULT_VARIANT_ID]
}

export function normalizeVariantForModel(
  requested: VariantId | string | undefined,
  args: {
    modelId: string
    provider?: RuntimeProvider
    capabilities: RuntimeModelCapabilities | null | undefined
  }
): VariantId {
  if (!args.capabilities) {
    if (requested && isVariantId(requested)) {
      return requested
    }
    return DEFAULT_VARIANT_ID
  }

  const supported = getSupportedVariantsForModel(args)
  if (requested && supported.includes(requested as VariantId)) {
    return requested as VariantId
  }
  if ((args.provider === 'google' || args.provider === 'anthropic') && supported.includes('high')) {
    return 'high'
  }
  if (supported.includes(DEFAULT_VARIANT_ID)) {
    return DEFAULT_VARIANT_ID
  }
  return supported[0]!
}

export function getAvailableAgentsForSurface(
  surface: AISurface,
  hasProjectContext: boolean
): AgentId[] {
  if (surface === 'wizard') return ['plan']
  if (surface === 'builder') return ['build']

  if (surface === 'assistant_project') {
    return ['assistant_project', 'explore', 'review', 'build']
  }

  if (hasProjectContext) {
    return ['assistant_project', 'explore', 'review', 'build']
  }
  return ['assistant_general']
}

export function normalizeAgentForSurface(
  requested: AgentId | undefined,
  surface: AISurface,
  hasProjectContext: boolean
): AgentId {
  const available = getAvailableAgentsForSurface(surface, hasProjectContext)
  if (requested && available.includes(requested)) {
    return requested
  }
  return DEFAULT_AGENT_BY_SURFACE[surface]
}

export function isLocalToolAllowedForAgent(args: {
  agentId: AgentId
  toolName: string
  hasProjectContext: boolean
}): boolean {
  const { agentId, toolName, hasProjectContext } = args
  const profile = AGENT_PROFILES[agentId]
  if (!profile) return false

  if (profile.requiresProjectContext && !hasProjectContext) {
    return false
  }

  switch (profile.localToolPolicy) {
    case 'none':
      return false
    case 'read':
      return READ_LOCAL_TOOLS.has(toolName)
    case 'review':
      return READ_LOCAL_TOOLS.has(toolName) || REVIEW_DIAGNOSTIC_TOOLS.has(toolName)
    case 'project_full':
    case 'builder_full':
      return hasProjectContext
    default:
      return false
  }
}
