import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@/features/assistant/chat/session-logic"
import {
  mergeSidebarActivity,
  resolveAgentActivity,
  type SidebarActivity,
} from "@/lib/sidebarActivity"
import { createAssistantThreadSelectorById, type AppState } from "@/features/assistant/model/assistantStore"
import type { Thread } from "@/features/assistant/model/types"
import type { ProjectId } from "@cozea/assistant-contracts"

/**
 * Whether a thread is parked on the user (an approval or an input prompt).
 *
 * Both derivations walk and sort the whole activity list, which is far too much
 * work to repeat on every assistant-store update for every project row. The
 * thread selector hands back a stable `activities` reference while nothing has
 * changed, so that array doubles as the cache key.
 */
const userGateCache = new WeakMap<Thread["activities"], boolean>()

function hasOpenUserGate(activities: Thread["activities"]): boolean {
  const cached = userGateCache.get(activities)
  if (cached !== undefined) return cached

  const gated =
    derivePendingApprovals(activities).length > 0 ||
    derivePendingUserInputs(activities).length > 0
  userGateCache.set(activities, gated)
  return gated
}

export function resolveThreadActivity(thread: Thread | null): SidebarActivity {
  if (!thread) return "idle"
  return resolveAgentActivity({
    sessionStatus: thread.session?.status ?? null,
    hasPendingApprovals: hasOpenUserGate(thread.activities),
    // `hasOpenUserGate` already folds both gates together; splitting them here
    // would double the walk for no extra signal.
    hasPendingUserInput: false,
  })
}

/**
 * Merged execution state for a lane's agents, for the collapsed project row.
 *
 * Returns a plain string, so the subscribing row only re-renders when the
 * verdict itself changes rather than on every token of a streaming turn.
 */
export function createAgentsActivitySelector(
  threadIds: readonly string[],
): (state: AppState) => SidebarActivity {
  const threadSelectors = threadIds.map((id) => createAssistantThreadSelectorById(id))

  return (state) => {
    if (threadSelectors.length === 0) return "idle"
    return mergeSidebarActivity(
      threadSelectors.map((selectThread) => resolveThreadActivity(selectThread(state))),
    )
  }
}

/**
 * Merged execution state for every thread belonging to a project, whichever
 * lane it lives in.
 *
 * The sidebar only fetches lane state for the focused or expanded row, so a
 * lane-scoped lookup reports nothing for background projects. `threadIdsByProjectId`
 * is global and survives focus changes, so this keeps reporting for all of them.
 *
 * The assistant store runs its own project id space, keyed off the workspace
 * path — the sidebar's Convex `project.id` is not a key in it and silently
 * resolves to no threads at all, so the cwd lookup has to come first.
 */
export function createProjectAgentsActivitySelector(input: {
  /** Convex project id; used only as a fallback. */
  projectId: string
  /** Workspace path, which is how the assistant store keys its projects. */
  workspaceId: string | null
}): (state: AppState) => SidebarActivity {
  const selectorByThreadId = new Map<string, (state: AppState) => Thread | null>()

  return (state) => {
    const assistantProjectId =
      (input.workspaceId ? state.projectIdByCwd[input.workspaceId] : undefined) ??
      (input.projectId as ProjectId)

    const threadIds = state.threadIdsByProjectId[assistantProjectId]
    if (!threadIds || threadIds.length === 0) return "idle"

    // Drop selectors for threads that have gone away, so a long session cannot
    // accumulate one closure per thread ever seen.
    if (selectorByThreadId.size > threadIds.length) {
      const live = new Set<string>(threadIds)
      for (const id of selectorByThreadId.keys()) {
        if (!live.has(id)) selectorByThreadId.delete(id)
      }
    }

    let winner: SidebarActivity = "idle"
    for (const threadId of threadIds) {
      let selectThread = selectorByThreadId.get(threadId)
      if (!selectThread) {
        selectThread = createAssistantThreadSelectorById(threadId)
        selectorByThreadId.set(threadId, selectThread)
      }
      winner = mergeSidebarActivity([winner, resolveThreadActivity(selectThread(state))])
      if (winner === "running") return winner
    }
    return winner
  }
}
