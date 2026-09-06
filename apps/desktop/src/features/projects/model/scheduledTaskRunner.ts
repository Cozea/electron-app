import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type NativeApi,
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
import { readAvailableNativeApi } from "@/lib/nativeApi"
import { scheduledTasksSnapshot } from "@/features/projects/model/scheduledTasksSnapshot"
import {
  isScheduledTaskRuntimeUnavailableError,
  ScheduledTaskRuntimeUnavailableError,
} from "@/features/projects/model/scheduledTaskRuntime"
import {
  SCHEDULED_TASK_PROVIDER_KINDS,
  scheduledTaskInstanceId,
} from "@/features/projects/model/scheduledTaskProviders"

const TICK_MS = 30_000

interface ScheduledTaskRunControl extends ScheduledTaskRunReport {
  computerUsePolicy: 'prepare'
  threadId: ThreadId
}

export interface ScheduledTaskRunnerOptions {
  readonly getNativeApi?: () => NativeApi | undefined
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

/** Resolve or create the assistant project using the already-ready runtime for this run. */
async function resolveAssistantProjectId(
  workspaceRoot: string,
  nativeApi: NativeApi,
): Promise<ProjectId> {
  const existing = selectAssistantProjectByCwd(useStore.getState(), workspaceRoot)
  if (existing) return existing.id

  try {
    await refreshAssistantRuntimeSnapshot(nativeApi)
  } catch (error: unknown) {
    throw new ScheduledTaskRuntimeUnavailableError(
      `Local agent runtime was unavailable before the scheduled run started: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const refreshed = selectAssistantProjectByCwd(useStore.getState(), workspaceRoot)
  if (refreshed) return refreshed.id

  const projectId = newProjectId()
  try {
    await nativeApi.orchestration.dispatchCommand({
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
    // A project.create command was already dispatched. Do not classify this as
    // retryable: a lost response is ambiguous and a blind retry could duplicate
    // side effects on runtimes that do not deduplicate the command.
    throw error
  }
}

/** Start one scheduled task as a normal visible conversation with main-owned CU authorization. */
export async function runScheduledTask(
  task: ScheduledTask,
  standaloneWorkspaceRoot: string,
  nativeApi: NativeApi | undefined = readAvailableNativeApi(),
): Promise<string> {
  const workspaceRoot = task.project?.workspaceRoot ?? standaloneWorkspaceRoot
  if (!workspaceRoot) throw new Error("No working directory for this task.")
  if (!nativeApi) {
    throw new ScheduledTaskRuntimeUnavailableError()
  }

  const orchestration = nativeApi.orchestration
  const projectId = await resolveAssistantProjectId(workspaceRoot, nativeApi)
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

  // If thread creation itself fails, the policy is bound to an ID that never
  // existed; a later run for the same task replaces that inert orphan.
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
    // Do not leave a user-reusable idle thread carrying the scheduled policy.
    // Deletion is an authoritative orchestration mutation; the policy itself
    // remains main-owned and will be replaced by the next run or cleared by
    // task/broker teardown.
    await orchestration
      .dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      })
      .catch(() => undefined)
    throw error
  }

  return threadId
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

/** Run all currently due tasks once, retrying only proven pre-dispatch runtime waits. */
async function tick(getNativeApi: () => NativeApi | undefined): Promise<void> {
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
            error: "Cozea couldn't run this task when it was due.",
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
        const threadId = await runScheduledTask(
          task,
          snapshot?.standaloneWorkspaceRoot ?? "",
          getNativeApi(),
        )
        await window.electronAPI.scheduledTasks.markRun({
          taskId: task.id,
          ranAt: now,
          status: "started",
          threadId,
        })
      } catch (error: unknown) {
        if (isScheduledTaskRuntimeUnavailableError(error)) {
          // No orchestration command was dispatched, so leaving the task due is
          // safe. The next scheduler tick (or runtime reconnect) can try again.
          continue
        }
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
export function startScheduledTaskRunner(
  options: ScheduledTaskRunnerOptions = {},
): () => void {
  if (typeof window === "undefined" || !window.electronAPI?.scheduledTasks) {
    return () => undefined
  }
  if (timer) return () => undefined
  const getNativeApi = options.getNativeApi ?? readAvailableNativeApi
  timer = setInterval(() => void tick(getNativeApi), TICK_MS)
  void tick(getNativeApi)
  return () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}
