const MARK_PREFIX = 'cozea:'

function getPerformance(): Performance | null {
  if (typeof performance === 'undefined') {
    return null
  }

  return performance
}

export function cozeaMarkName(name: string): string {
  return name.startsWith(MARK_PREFIX) ? name : `${MARK_PREFIX}${name}`
}

export function markCozeaPerformance(name: string, detail?: unknown): string {
  const markName = cozeaMarkName(name)
  const perf = getPerformance()
  if (!perf?.mark) {
    return markName
  }

  try {
    if (detail === undefined) {
      perf.mark(markName)
    } else {
      perf.mark(markName, { detail })
    }
  } catch {
    // Older Performance implementations may not support mark options.
    perf.mark(markName)
  }

  return markName
}

export function measureCozeaPerformance(
  name: string,
  startMark: string,
  endMark?: string,
): string {
  const measureName = cozeaMarkName(name)
  const perf = getPerformance()
  if (!perf?.measure) {
    return measureName
  }

  try {
    if (endMark) {
      perf.measure(measureName, startMark, endMark)
    } else {
      perf.measure(measureName, startMark)
    }
  } catch {
    // Missing marks should not make the app brittle; DevTools will still show successful marks.
  }

  return measureName
}

export function markCozeaInteractionStart(name: string, detail?: unknown): string {
  return markCozeaPerformance(`interaction:${name}:start`, detail)
}

export function markCozeaInteractionEnd(
  name: string,
  startMark: string,
  detail?: unknown,
): string {
  const endMark = markCozeaPerformance(`interaction:${name}:end`, detail)
  measureCozeaPerformance(`interaction:${name}`, startMark, endMark)
  return endMark
}
