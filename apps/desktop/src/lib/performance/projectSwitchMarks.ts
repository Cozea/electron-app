import {
  markCozeaInteractionEnd,
  markCozeaInteractionStart,
  markCozeaPerformance,
  measureCozeaPerformance,
} from "@/lib/performance/marks"

export type ProjectSwitchPhase =
  | "navigate"
  | "project-query"
  | "workspace-resolve"
  | "lane-settle"
  | "dockview-ready"
  | "first-tile-paint"

const SWITCH_NAME = "project-switch"

let activeStartMark: string | null = null
let activeSwitchId = 0
let watchdogTimer: ReturnType<typeof setTimeout> | null = null
const markedPhases = new Set<ProjectSwitchPhase>()

const SWITCH_WATCHDOG_MS = 5_000

function clearWatchdog(): void {
  if (watchdogTimer === null) {
    return
  }
  clearTimeout(watchdogTimer)
  watchdogTimer = null
}

export function beginProjectSwitch(detail?: unknown): string {
  activeSwitchId += 1
  markedPhases.clear()
  clearWatchdog()
  activeStartMark = markCozeaInteractionStart(SWITCH_NAME, {
    switchId: activeSwitchId,
    ...(detail && typeof detail === "object" ? (detail as Record<string, unknown>) : { detail }),
  })
  watchdogTimer = setTimeout(() => {
    endProjectSwitch({ reason: "watchdog" })
  }, SWITCH_WATCHDOG_MS)
  return activeStartMark
}

export function ensureProjectSwitchStarted(detail?: unknown): string {
  if (activeStartMark) {
    return activeStartMark
  }
  return beginProjectSwitch(detail)
}

export function markProjectSwitchPhase(phase: ProjectSwitchPhase, detail?: unknown): void {
  if (!activeStartMark || markedPhases.has(phase)) {
    return
  }
  markedPhases.add(phase)

  const phaseMark = markCozeaPerformance(`interaction:${SWITCH_NAME}:${phase}`, {
    switchId: activeSwitchId,
    phase,
    ...asDetailObject(detail),
  })
  measureCozeaPerformance(`interaction:${SWITCH_NAME}:${phase}`, activeStartMark, phaseMark)
}

export function endProjectSwitch(detail?: unknown): void {
  const startMark = activeStartMark
  if (!startMark) {
    return
  }
  clearWatchdog()
  markCozeaInteractionEnd(SWITCH_NAME, startMark, {
    switchId: activeSwitchId,
    ...asDetailObject(detail),
  })
  activeStartMark = null
  markedPhases.clear()
}

function asDetailObject(detail: unknown): Record<string, unknown> {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>
  }
  if (detail === undefined) {
    return {}
  }
  return { detail }
}
