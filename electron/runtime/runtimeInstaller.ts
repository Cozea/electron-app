import { runtimeLocks } from './runtimeLocks'
import { getRuntimeTarget, resolveRuntimeHealth } from './runtimeResolver'
import type { RuntimeEnsureResult, RuntimeKind } from './runtimeTypes'

export interface RuntimeInstallOptions {
  cleanBrokenLocalFiles?: boolean
  forceReinstall?: boolean
}

function formatMissingRuntimeError(runtime: RuntimeKind, existingError?: string): string {
  if (existingError && existingError.trim().length > 0) {
    return existingError
  }
  return `${runtime} must be installed on your system and available on PATH.`
}

export async function ensureRuntimeInstalled(
  runtime: RuntimeKind,
  target = getRuntimeTarget(),
  options: RuntimeInstallOptions = {}
): Promise<RuntimeEnsureResult> {
  return runtimeLocks.withLock(`${runtime}:${target}`, async () => {
    void options

    const existing = resolveRuntimeHealth(runtime, target)
    if (existing.available && existing.executablePath) {
      return {
        success: true,
        runtime,
        target,
        source: existing.source,
        executablePath: existing.executablePath,
        installed: false,
      }
    }

    return {
      success: false,
      runtime,
      target,
      source: existing.source,
      installed: false,
      error: formatMissingRuntimeError(runtime, existing.error),
    }
  })
}
