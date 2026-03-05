import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { RuntimeHealth, RuntimeKind, RuntimeResolveResult, RuntimeTarget } from './runtimeTypes'
import { resolveCommandIntent } from './commandResolver'

const KNOWN_RUNTIME_KINDS: RuntimeKind[] = [
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

function getExecutableName(runtime: RuntimeKind): string {
  if (process.platform !== 'win32') {
    if (runtime === 'rust') return 'cargo'
    return runtime
  }

  if (runtime === 'npm') return 'npm.cmd'
  if (runtime === 'pnpm') return 'pnpm.cmd'
  if (runtime === 'yarn') return 'yarn.cmd'
  if (runtime === 'corepack') return 'corepack.cmd'
  if (runtime === 'rust') return 'cargo.exe'
  if (runtime === 'go') return 'go.exe'
  if (runtime === 'python') return 'python.exe'
  if (runtime === 'bun') return 'bun.exe'
  return `${runtime}.exe`
}

export function getRuntimeTarget(): RuntimeTarget {
  return `${process.platform}-${process.arch}`
}

export function getRuntimeCacheRoot(): string {
  if (app.isReady()) {
    return path.join(app.getPath('userData'), 'runtimes')
  }
  return path.join(os.homedir(), '.cozea', 'runtimes')
}

function getBundledRuntimeRoots(): string[] {
  const roots = new Set<string>()
  const explicitRoot = process.env.COZEA_BUNDLED_RUNTIME_ROOT?.trim()
  if (explicitRoot) {
    roots.add(path.resolve(explicitRoot))
  }

  const appRoot = process.env.APP_ROOT || process.cwd()
  roots.add(path.join(appRoot, 'build', 'runtime'))
  roots.add(path.join(process.resourcesPath, 'runtime'))

  return Array.from(roots)
}

function resolveOverridePath(runtime: RuntimeKind): string | null {
  const envName = `COZEA_RUNTIME_${runtime.toUpperCase()}_PATH`
  const override = process.env[envName]
  if (!override) return null
  return fs.existsSync(override) ? override : null
}

function getBundledCandidate(runtime: RuntimeKind, target: RuntimeTarget): string | null {
  const executable = getExecutableName(runtime)
  const roots = getBundledRuntimeRoots()
  for (const root of roots) {
    const candidatePaths = [
      path.join(root, target, 'bin', executable),
      path.join(root, target, runtime, 'bin', executable),
      path.join(root, target, 'node', 'bin', executable),
    ]
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function getRuntimePackCandidate(runtime: RuntimeKind, target: RuntimeTarget): string {
  const executable = getExecutableName(runtime)
  return path.join(getRuntimeCacheRoot(), target, runtime, 'bin', executable)
}

function resolveSystemPath(binary: string): string | null {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(command, [binary], {
    env: process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) return null
  const first = (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return first || null
}

export function resolveRuntimeHealth(runtime: RuntimeKind, target = getRuntimeTarget()): RuntimeHealth {
  const override = resolveOverridePath(runtime)
  if (override) {
    return {
      runtime,
      target,
      source: 'override',
      available: true,
      executablePath: override,
    }
  }

  const bundled = getBundledCandidate(runtime, target)
  if (bundled && fs.existsSync(bundled)) {
    return {
      runtime,
      target,
      source: 'bundled',
      available: true,
      executablePath: bundled,
    }
  }

  const runtimePack = getRuntimePackCandidate(runtime, target)
  if (fs.existsSync(runtimePack)) {
    return {
      runtime,
      target,
      source: 'runtime-pack',
      available: true,
      executablePath: runtimePack,
    }
  }

  const system = resolveSystemPath(getExecutableName(runtime))
  if (system) {
    return {
      runtime,
      target,
      source: 'system',
      available: true,
      executablePath: system,
    }
  }

  return {
    runtime,
    target,
    source: 'missing',
    available: false,
    error: 'Runtime executable not found.',
  }
}

export function getRuntimePathPrefixes(target = getRuntimeTarget()): string[] {
  const prefixes = new Set<string>()
  for (const root of getBundledRuntimeRoots()) {
    prefixes.add(path.join(root, target, 'bin'))
    prefixes.add(path.join(root, target, 'node', 'bin'))
  }

  const cacheRoot = getRuntimeCacheRoot()
  for (const runtime of KNOWN_RUNTIME_KINDS) {
    prefixes.add(path.join(cacheRoot, target, runtime, 'bin'))
  }

  return Array.from(prefixes).filter((entry) => fs.existsSync(entry))
}

export function resolveCommandWithRuntime(command: string, target = getRuntimeTarget()): RuntimeResolveResult {
  const intent = resolveCommandIntent(command)
  if (intent.classification === 'unsupported') {
    return {
      success: false,
      command,
      status: 'failed',
      error: intent.reason,
      runtime: 'node',
      source: 'missing',
    }
  }

  if (intent.classification === 'unknown' || intent.runtime === 'unknown') {
    return {
      success: false,
      command,
      status: 'needs_user_approval',
      approvalPayload: {
        command,
        reason: 'Unknown command token. Approval required before execution.',
        alternatives: [],
      },
      error: intent.reason,
    }
  }

  const runtime = resolveRuntimeHealth(intent.runtime, target)
  if (!runtime.available || !runtime.executablePath) {
    return {
      success: false,
      command,
      status: 'failed',
      runtime: intent.runtime,
      source: runtime.source,
      error: runtime.error ?? 'Runtime missing.',
    }
  }

  return {
    success: true,
    command,
    resolvedCommand: command,
    runtime: intent.runtime,
    source: runtime.source,
    executablePath: runtime.executablePath,
    status: 'completed',
  }
}
