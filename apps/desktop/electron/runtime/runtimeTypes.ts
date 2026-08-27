export type RuntimeKind =
  | 'node'
  | 'npm'
  | 'corepack'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'python'
  | 'rust'
  | 'go'

export type RuntimeSource = 'override' | 'system' | 'missing'

export type RuntimeTarget = `${NodeJS.Platform}-${NodeJS.Architecture}` | string

export interface RuntimeHealth {
  runtime: RuntimeKind
  target: RuntimeTarget
  source: RuntimeSource
  available: boolean
  executablePath?: string
  version?: string
  error?: string
}

export interface RuntimeEnsureResult {
  success: boolean
  runtime: RuntimeKind
  target: RuntimeTarget
  source: RuntimeSource
  executablePath?: string
  installed?: boolean
  error?: string
}

export interface DevCommandSuggestion {
  command: string
  runtime: RuntimeKind | 'unknown'
  confidence: number
  reason: string
}

export interface DevServerConfig {
  suggestions: DevCommandSuggestion[]
  selectedCommand?: string
  requiresUserSelection: boolean
}

export interface ProjectRuntimeProfile {
  runtimes: RuntimeHealth[]
  devServer: DevServerConfig
  evidence: {
    files: string[]
    scripts: string[]
    lockfiles: string[]
  }
}

export interface RuntimeResolveResult {
  success: boolean
  command: string
  resolvedCommand?: string
  runtime?: RuntimeKind
  source?: RuntimeSource
  executablePath?: string
  status?: 'completed' | 'failed' | 'needs_user_approval'
  approvalPayload?: {
    command: string
    reason: string
    alternatives: string[]
  }
  error?: string
}

export interface CapabilityCatalogRule {
  id: string
  matchAnyFile?: string[]
  matchAnyScript?: string[]
  suggestedCommands: Array<{
    command: string
    runtime: RuntimeKind | 'unknown'
    confidence: number
    reason: string
  }>
}

export interface CapabilityCatalog {
  version: string
  generatedAt: string
  rules: CapabilityCatalogRule[]
}
