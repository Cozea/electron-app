import { createHash } from 'node:crypto'

import { resolveCommandIntent } from './commandResolver'
import type {
  CapabilityCatalog,
  DevCommandSuggestion,
  RuntimeHealth,
  RuntimeKind,
} from './runtimeTypes'
import type { ProjectEvidence } from './projectEvidence'

export const DEV_COMMAND_FEATURE_NAMES = [
  'manifestMatch',
  'scriptNameScore',
  'serverSignal',
  'packageManagerMatch',
  'frameworkMatch',
  'readmeMatch',
  'staticSiteMatch',
  'runtimeAvailable',
  'verifiedCommand',
  'productionPenalty',
] as const

export type DevCommandFeatureName = (typeof DEV_COMMAND_FEATURE_NAMES)[number]
export type DevCommandFeatures = Record<DevCommandFeatureName, number>
export type DevCommandCandidateSource = 'package_script' | 'catalog' | 'readme' | 'static_site'

export interface DevCommandCandidate extends DevCommandSuggestion {
  id: string
  source: DevCommandCandidateSource
  features: DevCommandFeatures
}

export function buildDevCommandFingerprint(
  evidence: ProjectEvidence,
  candidates: readonly DevCommandCandidate[],
): string {
  const payload = {
    files: [...evidence.files].sort(),
    scripts: Object.entries(evidence.packageScripts).sort(([left], [right]) => left.localeCompare(right)),
    lockfiles: [...evidence.lockfiles].sort(),
    readmeCommands: [...evidence.readmeCommands].sort(),
    candidates: candidates.map((candidate) => candidate.command).sort(),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

const SCRIPT_NAME_SCORES: Record<string, number> = {
  web: 1,
  dev: 0.98,
  develop: 0.92,
  serve: 0.86,
  start: 0.78,
  preview: 0.58,
}

const SERVER_SIGNAL_PATTERN = /\b(?:vite|next\s+dev|astro\s+dev|nuxt\s+dev|remix\s+dev|gatsby\s+develop|ng\s+serve|webpack(?:-dev-server)?|parcel|serve|http\.server|uvicorn|flask\s+run)\b/i
const FRAMEWORK_FILES = new Set([
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.ts',
  'svelte.config.js',
  'svelte.config.ts',
])

const STATIC_SITE_ENTRIES: ReadonlyArray<{
  entry: string
  directory: string | null
}> = [
  { entry: 'index.html', directory: null },
  { entry: 'dist/index.html', directory: 'dist' },
  { entry: 'build/index.html', directory: 'build' },
  { entry: 'out/index.html', directory: 'out' },
  { entry: 'public/index.html', directory: 'public' },
]

function emptyFeatures(): DevCommandFeatures {
  return {
    manifestMatch: 0,
    scriptNameScore: 0,
    serverSignal: 0,
    packageManagerMatch: 0,
    frameworkMatch: 0,
    readmeMatch: 0,
    staticSiteMatch: 0,
    runtimeAvailable: 0,
    verifiedCommand: 0,
    productionPenalty: 0,
  }
}

function detectPackageManager(evidence: ProjectEvidence): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (evidence.lockfiles.includes('bun.lock') || evidence.lockfiles.includes('bun.lockb')) return 'bun'
  if (evidence.lockfiles.includes('pnpm-lock.yaml')) return 'pnpm'
  if (evidence.lockfiles.includes('yarn.lock')) return 'yarn'
  return 'npm'
}

function buildPackageScriptCommand(packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun', scriptName: string): string {
  if (scriptName === 'start') {
    return packageManager === 'npm' ? 'npm start' : `${packageManager} start`
  }
  return `${packageManager} run ${scriptName}`
}

function stableCandidateId(source: DevCommandCandidateSource, command: string): string {
  return `devcmd_${createHash('sha256').update(`${source}\0${command}`).digest('hex').slice(0, 16)}`
}

function runtimeIsAvailable(
  runtime: RuntimeKind | 'unknown',
  runtimeHealth: readonly RuntimeHealth[],
): boolean {
  if (runtime === 'unknown') return false
  return runtimeHealth.some((health) => health.runtime === runtime && health.available)
}

function inferRuntime(command: string): RuntimeKind | 'unknown' {
  return resolveCommandIntent(command).runtime
}

function makeCandidate(input: {
  command: string
  runtime?: RuntimeKind | 'unknown'
  confidence: number
  reason: string
  source: DevCommandCandidateSource
  features: Partial<DevCommandFeatures>
  runtimeHealth: readonly RuntimeHealth[]
}): DevCommandCandidate | null {
  const command = input.command.trim()
  if (!command || resolveCommandIntent(command).classification !== 'supported') return null

  const runtime = input.runtime ?? inferRuntime(command)
  const features = { ...emptyFeatures(), ...input.features }
  features.runtimeAvailable = runtimeIsAvailable(runtime, input.runtimeHealth) ? 1 : 0

  return {
    id: stableCandidateId(input.source, command),
    command,
    runtime,
    confidence: input.confidence,
    reason: input.reason,
    source: input.source,
    features,
  }
}

function mergeCandidates(candidates: readonly DevCommandCandidate[]): DevCommandCandidate[] {
  const byCommand = new Map<string, DevCommandCandidate>()
  for (const candidate of candidates) {
    const existing = byCommand.get(candidate.command)
    if (!existing) {
      byCommand.set(candidate.command, candidate)
      continue
    }

    const features = { ...existing.features }
    for (const name of DEV_COMMAND_FEATURE_NAMES) {
      features[name] = Math.max(features[name], candidate.features[name])
    }
    byCommand.set(candidate.command, {
      ...existing,
      confidence: Math.max(existing.confidence, candidate.confidence),
      reason: `${existing.reason} ${candidate.reason}`.trim(),
      features,
    })
  }
  return Array.from(byCommand.values())
}

export function buildDevCommandCandidates(input: {
  evidence: ProjectEvidence
  catalog: CapabilityCatalog
  runtimeHealth: readonly RuntimeHealth[]
}): DevCommandCandidate[] {
  const { evidence, catalog, runtimeHealth } = input
  const candidates: DevCommandCandidate[] = []
  const packageManager = detectPackageManager(evidence)
  const hasFrameworkFile = evidence.files.some((file) => FRAMEWORK_FILES.has(file))

  for (const [scriptName, scriptCommand] of Object.entries(evidence.packageScripts)) {
    const scriptNameScore = SCRIPT_NAME_SCORES[scriptName.toLowerCase()]
    if (scriptNameScore === undefined) continue
    const command = buildPackageScriptCommand(packageManager, scriptName)
    const candidate = makeCandidate({
      command,
      runtime: packageManager,
      confidence: Math.min(0.97, 0.62 + scriptNameScore * 0.3),
      reason: `Found the ${scriptName} package script for ${packageManager}.`,
      source: 'package_script',
      runtimeHealth,
      features: {
        manifestMatch: 1,
        scriptNameScore,
        serverSignal: SERVER_SIGNAL_PATTERN.test(scriptCommand) ? 1 : 0,
        packageManagerMatch: 1,
        frameworkMatch: hasFrameworkFile ? 1 : 0,
        verifiedCommand: 1,
        productionPenalty: scriptName.toLowerCase() === 'preview' ? 1 : 0,
      },
    })
    if (candidate) candidates.push(candidate)
  }

  for (const rule of catalog.rules) {
    const fileMatch = (rule.matchAnyFile ?? []).some((candidate) => evidence.files.includes(candidate))
    const scriptMatch = (rule.matchAnyScript ?? []).some((script) => evidence.scripts.includes(script))
    if (!fileMatch && !scriptMatch) continue

    for (const suggestion of rule.suggestedCommands) {
      const candidate = makeCandidate({
        ...suggestion,
        source: 'catalog',
        runtimeHealth,
        features: {
          manifestMatch: fileMatch ? 1 : 0,
          scriptNameScore: scriptMatch ? 0.8 : 0,
          serverSignal: SERVER_SIGNAL_PATTERN.test(suggestion.command) ? 1 : 0,
          frameworkMatch: fileMatch ? 1 : 0,
          verifiedCommand: scriptMatch ? 1 : 0,
        },
      })
      if (candidate) candidates.push(candidate)
    }
  }

  for (const command of evidence.readmeCommands) {
    const candidate = makeCandidate({
      command,
      confidence: 0.64,
      reason: 'Found a safe launch command in the project README.',
      source: 'readme',
      runtimeHealth,
      features: {
        serverSignal: SERVER_SIGNAL_PATTERN.test(command) ? 1 : 0,
        readmeMatch: 1,
        verifiedCommand: 0.72,
      },
    })
    if (candidate) candidates.push(candidate)
  }

  const staticSite = STATIC_SITE_ENTRIES.find(({ entry }) => evidence.files.includes(entry))
  if (staticSite) {
    const directoryArgument = staticSite.directory
      ? ` --directory ${staticSite.directory}`
      : ''
    const candidate = makeCandidate({
      command: `python3 -m http.server {port} --bind 127.0.0.1${directoryArgument}`,
      runtime: 'python',
      confidence: 0.94,
      reason: staticSite.directory
        ? `Found a built static HTML entry point at ${staticSite.entry}.`
        : 'Found a root static HTML entry point.',
      source: 'static_site',
      runtimeHealth,
      features: {
        manifestMatch: 1,
        serverSignal: 1,
        staticSiteMatch: 1,
        verifiedCommand: 1,
      },
    })
    if (candidate) candidates.push(candidate)
  }

  return mergeCandidates(candidates).sort((left, right) => right.confidence - left.confidence)
}
