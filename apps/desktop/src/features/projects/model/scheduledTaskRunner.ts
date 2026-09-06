import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ProjectId,
  type ThreadId,
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

interface ScheduledTaskRunControl extends ScheduledTaskRunReport {
  computerUsePolicy: 'prepare'
  threadId: ThreadId
}

function basename(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

/** Ask Electron main to derive and bind the persisted task's CU policy before launch. */
async function prepareScheduledTaskComputerUsePolicy(
  taskId: string,
  threadId: ThreadId,
): Promise<void> {
  const control: ScheduledTaskRunControl = {
    taskId,
    threadId,
    ranAt: Date.now(),
    computerUsePolicy: 'prepare',
  }
  const result = await window.electronAPI.scheduledTasks.markRun(control)
  if (!result.success) {
    throw new Error(result.error ?? 'Could not prepare Computer Use policy.')
  }
}

/** Resolve or create the assistant project that owns a scheduled run's working directory. */
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
    const message = error instanceof Error ? error.message : String(error)
    const match = message.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/)
    if (match?.[1]) return match[1] as ProjectId
    throw error
  }
}

/** Start one scheduled task as a normal visible conversation with main-owned CU authorization. */
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
    model: task.model ?? DEFAULT_MODEL_BY_PROVIDER[provider],
    options: task.modelOptions,
  })
  const threadId = newThreadId()
  const createdAt = new Date().toISOString()

  // Main derives allow/deny from persisted task state. This must succeed before
  // the conversation exists so unattended desktop access always fails closed.
  await prepareScheduledTaskComputerUsePolicy(task.id, threadId)

  // If launch fails, the task-owned lease remains safely bound to this unused
  // thread ID. The next preparation for the same task replaces that orphan;
  // renderer code is never allowed to release an active policy.
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

  return threadId
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

/** Run all currently due tasks once, recording skips/failures instead of retrying every tick. */
async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const snapshot = await scheduledTasksSnapshot.ensure().catch(() => null)
    const now = Date.now()
    const due = dueScheduledTasks(snapshot?.tasks ?? [], now)
    if (due.length === 0) return

    for (const task of due) {
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

/** Start the renderer scheduler while Cozea is open; main/T3 own CU policy lifetime. */
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
  }
}
