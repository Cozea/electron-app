import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ProjectId,
} from "@cozea/assistant-contracts"
import {
  dueScheduledTasks,
  isScheduledTaskStale,
  type ScheduledTask,
  type ScheduledTaskRunReport,
} from "@shared/scheduledTasks"

import {
  selectAssistantProjectByCwd,
  useStore,
} from "@/features/assistant/model/assistantStore"
import { newCommandId, newMessageId, newProjectId, newThreadId } from "@/features/assistant/lib/utils"
import { normalizeModelSelection } from "@/features/workbench/assistant/workbenchAssistantShared"
import { refreshAssistantRuntimeSnapshot } from "@/features/workbench/useAssistantRuntimeSync"
import { ensureNativeApi } from "@/lib/nativeApi"
import { scheduledTasksSnapshot } from "@/features/projects/model/scheduledTasksSnapshot"
import {
  SCHEDULED_TASK_PROVIDER_KINDS,
  scheduledTaskInstanceId,
} from "@/features/projects/model/scheduledTaskProviders"

const TICK_MS = 30_000

type ScheduledTaskComputerUsePolicyAction = "prepare" | "clear"

interface ScheduledTaskRunControl extends ScheduledTaskRunReport {
  computerUsePolicy: ScheduledTaskComputerUsePolicyAction
  threadId: string
}

const activeComputerUsePolicies = new Map<string, string>()
const computerUsePolicyWatchers = new Map<string, () => void>()

function basename(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

async function controlScheduledTaskComputerUsePolicy(
  taskId: string,
  threadId: string,
  computerUsePolicy: ScheduledTaskComputerUsePolicyAction,
): Promise<void> {
  const report: ScheduledTaskRunControl = {
    taskId,
    threadId,
    ranAt: Date.now(),
    computerUsePolicy,
  }
  const result = await window.electronAPI.scheduledTasks.markRun(report)
  if (!result.success) {
    throw new Error(result.error ?? `Could not ${computerUsePolicy} Computer Use policy.`)
  }
  if (computerUsePolicy === "prepare") activeComputerUsePolicies.set(threadId, taskId)
  else activeComputerUsePolicies.delete(threadId)
}

async function clearScheduledTaskComputerUsePolicy(taskId: string, threadId: string): Promise<void> {
  await controlScheduledTaskComputerUsePolicy(taskId, threadId, "clear")
}

function watchScheduledTaskComputerUsePolicy(
  taskId: string,
  threadId: string,
  previousTurnId: string | null,
): void {
  computerUsePolicyWatchers.get(threadId)?.()

  let unsubscribe: () => void = () => undefined
  let clearing = false
  const inspect = (state: ReturnType<typeof useStore.getState>): void => {
    const latestTurn = state.threadTurnStateById[threadId]?.latestTurn ?? null
    if (!latestTurn || latestTurn.turnId === previousTurnId || latestTurn.state === "running") return
    if (
      latestTurn.state !== "completed" &&
      latestTurn.state !== "interrupted" &&
      latestTurn.state !== "error"
    ) {
      return
    }
    unsubscribe()
    computerUsePolicyWatchers.delete(threadId)
    if (clearing) return
    clearing = true
    void clearScheduledTaskComputerUsePolicy(taskId, threadId).catch((error: unknown) => {
      console.warn("[ScheduledTasks] Failed to clear Computer Use policy:", error)
    })
  }

  unsubscribe = useStore.subscribe(inspect)
  computerUsePolicyWatchers.set(threadId, unsubscribe)
  inspect(useStore.getState())
}

/**
 * Resolve the assistant project that owns a working directory, creating one
 * when this is the first run there. Mirrors what a chat tile does on its first
 * send, because a scheduled run is the same thing without a person watching.
 */
async function resolveAssistantProjectId(workspaceRoot: string): Promise<ProjectId> {
  const orchestration = ensureNativeApi().orchestration
  const existing =
    selectAssistantProjectByCwd(useStore.getState(), workspaceRoot) ??
    (await refreshAssistantRuntimeSnapshot()
      .then(() => selectAssistantProjectByCwd(useStore.getState(), workspaceRoot))
      .catch(() => null))
  if (existing) return existing.id

  const projectId = newProjectId()
  try {
    await orchestration.dispatchCommand({
      type: "project.create",
      commandId: newCommandId(),
      projectId,
      title: basename(workspaceRoot),
      workspaceRoot,
      defaultModelSelection: null,
      createdAt: new Date().toISOString(),
    })
    return projectId
  } catch (error: unknown) {
    // The runtime rejects a duplicate by naming the project that already owns
    // this root; adopting it is right, inventing a second one is not.
    const message = error instanceof Error ? error.message : String(error)
    const match = message.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/)
    if (match?.[1]) return match[1] as ProjectId
    throw error
  }
}

/**
 * Start one task as a real conversation: the run shows up in chat history like
 * any other, so a scheduled agent is never doing work nobody can see.
 */
export async function runScheduledTask(
  task: ScheduledTask,
  standaloneWorkspaceRoot: string,
): Promise<string> {
  const workspaceRoot = task.project?.workspaceRoot ?? standaloneWorkspaceRoot
  if (!workspaceRoot) throw new Error("No working directory for this task.")

  const orchestration = ensureNativeApi().orchestration
  const projectId = await resolveAssistantProjectId(workspaceRoot)
  const provider = SCHEDULED_TASK_PROVIDER_KINDS[task.provider]
  const modelSelection = normalizeModelSelection({
    provider,
    instanceId: scheduledTaskInstanceId(task.provider),
    // The task carries the model and reasoning level chosen when it was saved,
    // so a run does not drift with whatever the composer last used.
    model: task.model ?? DEFAULT_MODEL_BY_PROVIDER[provider],
    options: task.modelOptions,
  })
  const threadId = newThreadId()
  const createdAt = new Date().toISOString()

  await orchestration.dispatchCommand({
    type: "thread.create",
    commandId: newCommandId(),
    threadId,
    projectId,
    title: task.name,
    modelSelection,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    createdAt,
  })

  const previousTurnId = useStore.getState().threadTurnStateById[threadId]?.latestTurn?.turnId ?? null
  await controlScheduledTaskComputerUsePolicy(task.id, threadId, "prepare")

  try {
    await orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId,
      message: {
        messageId: newMessageId(),
        role: "user",
        text: task.prompt,
        attachments: [],
      },
      modelSelection,
      titleSeed: task.name,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt,
    })
  } catch (error: unknown) {
    await clearScheduledTaskComputerUsePolicy(task.id, threadId).catch(() => undefined)
    throw error
  }

  // T3 already forwards turn-ended when a CU tool was actually used. This
  // watcher covers the equally important no-CU path, including explicit deny
  // tasks, by clearing the lease when the newly-started canonical turn settles.
  watchScheduledTaskComputerUsePolicy(task.id, threadId, previousTurnId)
  return threadId
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const snapshot = await scheduledTasksSnapshot.ensure().catch(() => null)
    const now = Date.now()
    const due = dueScheduledTasks(snapshot?.tasks ?? [], now)
    if (due.length === 0) return

    for (const task of due) {
      // Skipped runs are still recorded: a task that woke up hours late should
      // move on to its next slot rather than fire a stale run or retry forever.
      if (isScheduledTaskStale(task, now)) {
        await window.electronAPI.scheduledTasks
          .markRun({
            taskId: task.id,
            ranAt: now,
            status: "skipped",
            error: "Cozea was not running when this was due.",
          })
          .catch(() => undefined)
        continue
      }
      if (task.computerUse && snapshot?.computerUseEnabled !== true) {
        await window.electronAPI.scheduledTasks
          .markRun({
            taskId: task.id,
            ranAt: now,
            status: "skipped",
            error: "Computer Use is disabled in Settings.",
          })
          .catch(() => undefined)
        continue
      }
      try {
        const threadId = await runScheduledTask(task, snapshot?.standaloneWorkspaceRoot ?? "")
        await window.electronAPI.scheduledTasks.markRun({
          taskId: task.id,
          ranAt: now,
          status: "started",
          threadId,
        })
      } catch (error: unknown) {
        await window.electronAPI.scheduledTasks
          .markRun({
            taskId: task.id,
            ranAt: now,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })
          .catch(() => undefined)
      }
    }
    await scheduledTasksSnapshot.refresh().catch(() => undefined)
  } finally {
    ticking = false
  }
}

/**
 * Runs while Cozea is open, which is the whole promise: nothing fires with the
 * app closed, and the card says when a run was missed.
 */
export function startScheduledTaskRunner(): () => void {
  if (typeof window === "undefined" || !window.electronAPI?.scheduledTasks) {
    return () => undefined
  }
  if (timer) return () => undefined
  timer = setInterval(() => void tick(), TICK_MS)
  void tick()
  return () => {
    if (timer) clearInterval(timer)
    timer = null
    for (const unsubscribe of computerUsePolicyWatchers.values()) unsubscribe()
    computerUsePolicyWatchers.clear()
    for (const [threadId, taskId] of activeComputerUsePolicies) {
      void clearScheduledTaskComputerUsePolicy(taskId, threadId).catch((error: unknown) => {
        console.warn("[ScheduledTasks] Failed to clear Computer Use policy during teardown:", error)
      })
    }
  }
}
