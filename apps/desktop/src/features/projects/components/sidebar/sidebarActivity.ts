import type { DevServerStatus } from "@/features/projects/devserver/devServerRunStore"
import type { ThreadSession } from "@/stores/types"

/**
 * Single source of truth for "is this thing actively executing a process?".
 *
 * The sidebar animates on execution, not on presence: a tile that is merely open
 * (an idle shell, a connected-but-quiet agent, a stopped dev server) reads `idle`.
 * Both the project row and the nested tile rows resolve through this module so the
 * two levels can never disagree about what is running.
 */
export type SidebarActivity = "idle" | "starting" | "running"

const ACTIVITY_RANK: Record<SidebarActivity, number> = {
  idle: 0,
  starting: 1,
  running: 2,
}

export function isSidebarActivityLive(activity: SidebarActivity): boolean {
  return activity !== "idle"
}

/**
 * A turn parked on an approval or an input prompt is waiting on the user, not
 * executing — the provider session stays `running` throughout, so the pending
 * checks have to come first.
 */
export function resolveAgentActivity(input: {
  sessionStatus?: ThreadSession["status"] | null
  hasPendingApprovals: boolean
  hasPendingUserInput: boolean
}): SidebarActivity {
  if (input.hasPendingApprovals || input.hasPendingUserInput) {
    return "idle"
  }
  if (input.sessionStatus === "running") return "running"
  if (input.sessionStatus === "connecting") return "starting"
  return "idle"
}

export function resolveDevServerActivity(status: DevServerStatus | null | undefined): SidebarActivity {
  if (status === "starting") return "starting"
  // `unhealthy` still has a live process behind it — it is running, just failing.
  if (status === "ready" || status === "unhealthy") return "running"
  return "idle"
}

/**
 * Terminals report the pty's real foreground-process state, polled in the main
 * process (`terminalHost` → `terminal.activity`). A shell sitting at its prompt
 * has no subprocess and therefore reads `idle`.
 */
export function resolveTerminalActivity(input: {
  hasRunningSubprocess: boolean
  isSessionAlive: boolean
}): SidebarActivity {
  if (!input.isSessionAlive) return "idle"
  return input.hasRunningSubprocess ? "running" : "idle"
}

/** Loudest wins: one running tile makes the whole set read as running. */
export function mergeSidebarActivity(
  activities: Iterable<SidebarActivity>,
): SidebarActivity {
  let winner: SidebarActivity = "idle"
  for (const activity of activities) {
    if (ACTIVITY_RANK[activity] > ACTIVITY_RANK[winner]) {
      winner = activity
      if (winner === "running") return winner
    }
  }
  return winner
}

/**
 * Modality rule. The animation lives on one level at a time: expanded, the tile
 * rows own it and the project row stays still; collapsed, the project row
 * stands in for the tiles the user cannot see.
 *
 * `visibleActivity` is what the expanded rows already show. The sidebar renders
 * only the active lane, so work in another lane has no row of its own — the
 * project row keeps carrying that even while expanded, rather than the signal
 * disappearing on expand.
 */
export function resolveProjectRowActivity(input: {
  isExpanded: boolean
  projectActivity: SidebarActivity
  visibleActivity: SidebarActivity
}): SidebarActivity {
  if (!input.isExpanded) return input.projectActivity
  return input.visibleActivity === input.projectActivity ? "idle" : input.projectActivity
}
