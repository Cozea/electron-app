export interface AbortOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

interface AbortSignalFactoryResult {
  signal: AbortSignal
  cleanup: () => void
}

function hasAbortSignalAny(): boolean {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
}

function hasAbortSignalTimeout(): boolean {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
}

export function composeAbortSignal(options: AbortOptions = {}): AbortSignalFactoryResult {
  const { signal, timeoutMs } = options
  const signals: AbortSignal[] = []
  const cleanupFns: Array<() => void> = []

  if (signal) signals.push(signal)

  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    if (hasAbortSignalTimeout()) {
      signals.push(AbortSignal.timeout(timeoutMs))
    } else {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      cleanupFns.push(() => clearTimeout(timer))
      signals.push(controller.signal)
    }
  }

  if (signals.length === 0) {
    return { signal: new AbortController().signal, cleanup: () => undefined }
  }

  if (signals.length === 1) {
    return {
      signal: signals[0],
      cleanup: () => cleanupFns.forEach((fn) => fn()),
    }
  }

  if (hasAbortSignalAny()) {
    return {
      signal: AbortSignal.any(signals),
      cleanup: () => cleanupFns.forEach((fn) => fn()),
    }
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const part of signals) {
    if (part.aborted) {
      controller.abort()
      break
    }
    part.addEventListener('abort', abort, { once: true })
    cleanupFns.push(() => part.removeEventListener('abort', abort))
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanupFns.forEach((fn) => fn()),
  }
}

export async function fetchWithAbort(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AbortOptions = {}
): Promise<Response> {
  const { signal, cleanup } = composeAbortSignal({
    signal: options.signal ?? init.signal ?? undefined,
    timeoutMs: options.timeoutMs,
  })

  try {
    return await fetch(input, { ...init, signal })
  } finally {
    cleanup()
  }
}

