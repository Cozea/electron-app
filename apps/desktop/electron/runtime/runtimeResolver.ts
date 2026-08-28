import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { RuntimeHealth, RuntimeKind, RuntimeResolveResult, RuntimeTarget } from './runtimeTypes'
import { resolveCommandIntent } from './commandResolver'

interface ElectronAppLike {
  isReady: () => boolean
  getPath: (name: 'userData') => string
}

const SYSTEM_MANAGED_RUNTIMES = new Set<RuntimeKind>([
  'node',
  'npm',
  'corepack',
  'pnpm',
  'yarn',
  'bun',
  'python',
  'rust',
  'go',
])

function getExecutableNames(runtime: RuntimeKind, commandToken?: string): string[] {
  if (process.platform !== 'win32') {
    if (runtime === 'rust') return ['cargo']
    if (runtime === 'python') {
      if (commandToken === 'python3') return ['python3']
      if (commandToken === 'python') return ['python']
      return ['python3', 'python']
    }
    return [runtime]
  }

  if (runtime === 'npm') return ['npm.cmd']
  if (runtime === 'pnpm') return ['pnpm.cmd']
  if (runtime === 'yarn') return ['yarn.cmd']
  if (runtime === 'corepack') return ['corepack.cmd']
  if (runtime === 'rust') return ['cargo.exe']
  if (runtime === 'go') return ['go.exe']
  if (runtime === 'python') {
    if (commandToken === 'python3') return ['python3.exe']
    return ['python.exe']
  }
  if (runtime === 'bun') return ['bun.exe']
  return [`${runtime}.exe`]
}

export function getRuntimeTarget(): RuntimeTarget {
  return `${process.platform}-${process.arch}`
}

export function getRuntimeCacheRoot(): string {
  try {
    const requireElectron = createRequire(import.meta.url)
    const electron = requireElectron('electron') as { app?: ElectronAppLike }
    if (electron.app && typeof electron.app.isReady === 'function' && electron.app.isReady()) {
      return path.join(electron.app.getPath('userData'), 'runtimes')
    }
  } catch {
    // Workbench runtime children run with ELECTRON_RUN_AS_NODE in packaged builds,
    // where the Electron module is not available.
  }

  return path.join(os.homedir(), '.cozea', 'runtimes')
}

function resolveOverridePath(runtime: RuntimeKind): string | null {
  const envName = `COZEA_RUNTIME_${runtime.toUpperCase()}_PATH`
  const override = process.env[envName]
  if (!override) return null
  return fs.existsSync(override) ? override : null
}

function getPathEntries(): string[] {
  const rawPath = process.env.PATH
  if (!rawPath) return []

  return rawPath
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

function isExecutable(candidate: string): boolean {
  try {
    if (process.platform === 'win32') {
      return fs.existsSync(candidate)
    }

    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveSystemPath(binary: string): string | null {
  for (const entry of getPathEntries()) {
    const candidate = path.join(entry, binary)
    if (isExecutable(candidate)) {
      return candidate
    }
  }

  return null
}

export function resolveRuntimeHealth(
  runtime: RuntimeKind,
  target = getRuntimeTarget(),
  commandToken?: string,
): RuntimeHealth {
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

  const system = getExecutableNames(runtime, commandToken)
    .map((binary) => resolveSystemPath(binary))
    .find((candidate): candidate is string => candidate !== null)
  if (system) {
    return {
      runtime,
      target,
      source: 'system',
      available: true,
      executablePath: system,
    }
  }

  const missingError = SYSTEM_MANAGED_RUNTIMES.has(runtime)
    ? `${runtime} must be installed on your system and available on PATH.`
    : 'Runtime executable not found.'

  return {
    runtime,
    target,
    source: 'missing',
    available: false,
    error: missingError,
  }
}

export function getRuntimePathPrefixes(_target = getRuntimeTarget()): string[] {
  return []
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

  const runtime = resolveRuntimeHealth(intent.runtime, target, intent.token)
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
