export interface GeneratedPlanPage {
  id?: string
  name: string
  route?: string
  type?: string
  purpose?: string
  actions?: string[]
}

export interface GeneratedPlanEntity {
  id?: string
  name: string
  fields?: string[]
}

export interface GeneratedPlan {
  pages: GeneratedPlanPage[]
  entities: GeneratedPlanEntity[]
}

// Normalized types with required fields (after normalization)
export interface NormalizedPlanPage {
  id: string
  name: string
  route: string
  type: string
  purpose?: string
  actions?: string[]
}

export interface NormalizedPlanEntity {
  id: string
  name: string
  fields?: string[]
}

export interface NormalizedGeneratedPlan {
  pages: NormalizedPlanPage[]
  entities: NormalizedPlanEntity[]
}

// For this release, only web projects are executable.
// Reserved for future use (not yet enabled): 'desktop' | 'mobile'.
export type TargetPlatform = 'web'

export interface BuildContract {
  previewMode: 'web'
  frameworkClass: 'web-framework'
  toolchain?: Record<string, unknown>
  commands?: Record<string, unknown>
  constraints?: Record<string, unknown>
  fallbackPolicy?: Record<string, unknown>
  successCriteria?: Record<string, unknown>
  telemetryHints?: Record<string, unknown>
}

export interface WebOnlyPlanConfigContract {
  targetPlatform?: string
  buildContract?: BuildContract | Record<string, unknown>
}

interface ValidationResult {
  valid: boolean
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getDefaultWebBuildContract(): BuildContract {
  return {
    previewMode: 'web',
    frameworkClass: 'web-framework',
  }
}

export function validateWebOnlyBuildContract(buildContract: unknown): ValidationResult {
  if (!isRecord(buildContract)) {
    return { valid: false, error: 'Missing build contract.' }
  }

  if (buildContract.previewMode !== 'web') {
    return { valid: false, error: 'Build contract previewMode must be "web".' }
  }

  if (buildContract.frameworkClass !== 'web-framework') {
    return { valid: false, error: 'Build contract frameworkClass must be "web-framework".' }
  }

  return { valid: true }
}

export function validateWebOnlyPlanConfig(config: WebOnlyPlanConfigContract | null | undefined): ValidationResult {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Missing plan configuration.' }
  }

  if (config.targetPlatform !== 'web') {
    return { valid: false, error: 'Plan targetPlatform must be "web".' }
  }

  return validateWebOnlyBuildContract(config.buildContract)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function ensureId(value?: string): string {
  if (value && value.trim().length > 0) return value
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `id_${Math.random().toString(36).slice(2, 10)}`
}

function ensureRoute(name: string, route?: string): string {
  if (route && route.trim().length > 0) {
    return route.startsWith("/") ? route : `/${route}`
  }
  const base = slugify(name || "page")
  return `/${base || "page"}`
}

export function normalizeGeneratedPlan(plan: GeneratedPlan): NormalizedGeneratedPlan {
  const pages = (plan.pages || []).map((page) => {
    const name = page.name || "Untitled Page"
    return {
      id: ensureId(page.id),
      name,
      route: ensureRoute(name, page.route),
      type: page.type || "page",
      purpose: page.purpose,
      actions: page.actions,
    }
  })

  const entities = (plan.entities || []).map((entity) => ({
    id: ensureId(entity.id),
    name: entity.name || "Entity",
    fields: entity.fields,
  }))

  return { pages, entities }
}
