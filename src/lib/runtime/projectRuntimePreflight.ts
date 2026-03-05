import type {
  ProjectRuntimeProfile,
  RuntimeEnsureResult,
  RuntimeKind,
} from '@/types/electron'

const RUNTIME_PRIORITY: RuntimeKind[] = [
  'node',
  'npm',
  'corepack',
  'pnpm',
  'yarn',
  'bun',
  'python',
  'rust',
  'go',
]

const RUNTIME_LABELS: Record<RuntimeKind, string> = {
  node: 'Node.js',
  npm: 'npm',
  corepack: 'Corepack',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  bun: 'Bun',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
}

export interface RuntimePreflightProgress {
  phase: 'detecting' | 'installing' | 'done'
  message: string
  runtime?: RuntimeKind
  index?: number
  total?: number
}

export interface RuntimePreflightResult {
  success: boolean
  required: RuntimeKind[]
  installed: RuntimeKind[]
  alreadyAvailable: RuntimeKind[]
  failedRuntime?: RuntimeKind
  error?: string
}

function normalizeRuntimeList(runtimes: Iterable<RuntimeKind>): RuntimeKind[] {
  const set = new Set<RuntimeKind>(runtimes)
  return [...RUNTIME_PRIORITY.filter((runtime) => set.has(runtime))]
}

function collectRequiredRuntimes(profile: ProjectRuntimeProfile): RuntimeKind[] {
  const required = new Set<RuntimeKind>()

  for (const suggestion of profile.devServer?.suggestions ?? []) {
    if (suggestion.runtime !== 'unknown') {
      required.add(suggestion.runtime)
    }
  }

  const evidenceFiles = new Set([...(profile.evidence?.files ?? []), ...(profile.evidence?.lockfiles ?? [])])

  if (evidenceFiles.has('package.json')) required.add('npm')
  if (evidenceFiles.has('package-lock.json')) required.add('npm')
  if (evidenceFiles.has('pnpm-lock.yaml')) required.add('pnpm')
  if (evidenceFiles.has('yarn.lock')) required.add('yarn')
  if (evidenceFiles.has('bun.lock') || evidenceFiles.has('bun.lockb')) required.add('bun')
  if (evidenceFiles.has('pyproject.toml') || evidenceFiles.has('requirements.txt')) required.add('python')
  if (evidenceFiles.has('Cargo.toml')) required.add('rust')
  if (evidenceFiles.has('go.mod')) required.add('go')

  return normalizeRuntimeList(required)
}

function isEnsureFailure(result: RuntimeEnsureResult): boolean {
  return !result.success
}

export function runtimeLabel(runtime: RuntimeKind): string {
  return RUNTIME_LABELS[runtime] ?? runtime
}

export async function ensureProjectRuntimeToolchains(
  projectPath: string,
  onProgress?: (progress: RuntimePreflightProgress) => void
): Promise<RuntimePreflightResult> {
  if (!window.electronAPI?.runtime?.getProjectCapabilities || !window.electronAPI?.runtime?.ensureRuntime) {
    return {
      success: true,
      required: [],
      installed: [],
      alreadyAvailable: [],
    }
  }

  onProgress?.({
    phase: 'detecting',
    message: 'Checking required runtimes...',
  })

  const profile = await window.electronAPI.runtime.getProjectCapabilities({ projectPath })
  const required = collectRequiredRuntimes(profile)

  if (required.length === 0) {
    onProgress?.({
      phase: 'done',
      message: 'No additional runtime setup needed.',
    })
    return {
      success: true,
      required,
      installed: [],
      alreadyAvailable: [],
    }
  }

  const installed: RuntimeKind[] = []
  const alreadyAvailable: RuntimeKind[] = []

  for (let index = 0; index < required.length; index += 1) {
    const runtime = required[index]
    onProgress?.({
      phase: 'installing',
      runtime,
      index: index + 1,
      total: required.length,
      message: `Preparing ${runtimeLabel(runtime)} runtime (${index + 1}/${required.length})...`,
    })

    const ensureResult = await window.electronAPI.runtime.ensureRuntime({ runtime })
    if (isEnsureFailure(ensureResult)) {
      return {
        success: false,
        required,
        installed,
        alreadyAvailable,
        failedRuntime: runtime,
        error: ensureResult.error || `${runtimeLabel(runtime)} runtime is unavailable.`,
      }
    }

    if (ensureResult.installed) {
      installed.push(runtime)
    } else {
      alreadyAvailable.push(runtime)
    }
  }

  const installedLabels = installed.map(runtimeLabel)
  const doneMessage = installedLabels.length > 0
    ? `Runtime setup complete: ${installedLabels.join(', ')}`
    : 'Runtime setup complete.'

  onProgress?.({
    phase: 'done',
    message: doneMessage,
  })

  return {
    success: true,
    required,
    installed,
    alreadyAvailable,
  }
}
