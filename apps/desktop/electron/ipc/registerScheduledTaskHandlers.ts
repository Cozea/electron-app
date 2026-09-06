import type { IpcMain } from 'electron'

import { ComputerUseRuntimeService } from '../services/ComputerUseRuntimeService'
import type {
  ScheduledTaskDraft,
  ScheduledTaskMutationResult,
  ScheduledTaskRunReport,
  ScheduledTasksSnapshot,
} from '../../../../shared/scheduledTasks'
import type { AppSettings } from '../../../../shared/electronApiTypes'

interface LazyScheduledTaskService {
  list(): ScheduledTasksSnapshot['tasks']
  standaloneWorkspaceRoot(): string
  save(draft: ScheduledTaskDraft): ScheduledTaskMutationResult
  setEnabled(options: { taskId: string; enabled: boolean }): ScheduledTaskMutationResult
  markRun(report: ScheduledTaskRunReport): ScheduledTaskMutationResult
  markRunSeen(options: { taskId: string; runId: string }): ScheduledTaskMutationResult
  remove(options: { taskId: string }): ScheduledTaskMutationResult
}

interface ScheduledTaskRunControl extends ScheduledTaskRunReport {
  computerUsePolicy?: 'prepare'
}

let servicePromise: Promise<LazyScheduledTaskService> | null = null

function getScheduledTaskService(): Promise<LazyScheduledTaskService> {
  servicePromise ??= import('../services/ScheduledTaskService').then(
    ({ ScheduledTaskService }) =>
      ScheduledTaskService.getInstance() as unknown as LazyScheduledTaskService,
  )
  return servicePromise
}

function reportThreadId(report: ScheduledTaskRunReport): string {
  return typeof report.threadId === 'string' ? report.threadId.trim() : ''
}

/** Register Scheduled Tasks IPC while keeping unattended Computer Use authority in main. */
export function registerScheduledTaskHandlers(
  ipcMain: IpcMain,
  deps: { loadSettings: () => AppSettings },
): void {
  ipcMain.handle('scheduledTasks:list', async (): Promise<ScheduledTasksSnapshot> => {
    const service = await getScheduledTaskService()
    return {
      tasks: service.list(),
      computerUseEnabled: deps.loadSettings().computerUseEnabled === true,
      standaloneWorkspaceRoot: service.standaloneWorkspaceRoot(),
    }
  })

  ipcMain.handle('scheduledTasks:save', async (_event, draft: ScheduledTaskDraft) => {
    const service = await getScheduledTaskService()
    const result = service.save(draft)
    // Turning Computer Use off on a task revokes an in-flight scheduled allow.
    // Turning it back on never upgrades the current turn; the next run prepares
    // a fresh allow from persisted state.
    if (result.success && draft.taskId && draft.computerUse !== true) {
      ComputerUseRuntimeService.getInstance().revokeScheduledTaskPolicy(draft.taskId)
    }
    return result
  })

  ipcMain.handle(
    'scheduledTasks:setEnabled',
    async (_event, options: { taskId: string; enabled: boolean }) =>
      (await getScheduledTaskService()).setEnabled(options),
  )

  ipcMain.handle('scheduledTasks:markRun', async (_event, report: ScheduledTaskRunReport) => {
    const service = await getScheduledTaskService()
    const control = report as ScheduledTaskRunControl

    // Preparation is the only policy-control action exposed to the renderer.
    // Main reads the persisted task and derives allow/deny itself. Policy release
    // comes only from T3's accepted terminal lifecycle or main-owned teardown.
    if (control.computerUsePolicy === 'prepare') {
      const threadId = reportThreadId(report)
      if (!threadId) return { success: false, error: 'Scheduled task policy requires a thread.' }
      const task = service.list().find((candidate) => candidate.id === report.taskId)
      if (!task) return { success: false, error: 'That scheduled task no longer exists.' }
      if (task.computerUse && deps.loadSettings().computerUseEnabled !== true) {
        return { success: false, error: 'Computer Use is disabled in Settings.' }
      }
      ComputerUseRuntimeService.getInstance().setScheduledThreadPolicy(
        task.id,
        threadId,
        task.computerUse ? 'allow' : 'deny',
      )
      return { success: true, taskId: task.id }
    }

    return service.markRun(report)
  })

  ipcMain.handle(
    'scheduledTasks:markRunSeen',
    async (_event, options: { taskId: string; runId: string }) =>
      (await getScheduledTaskService()).markRunSeen(options),
  )

  ipcMain.handle('scheduledTasks:remove', async (_event, options: { taskId: string }) => {
    const service = await getScheduledTaskService()
    const result = service.remove(options)
    if (result.success) {
      // Removing the task must not widen an already-running scheduled turn to
      // inherit. Keep/reduce its authority to deny until authoritative terminal
      // lifecycle cleanup removes the policy.
      ComputerUseRuntimeService.getInstance().revokeScheduledTaskPolicy(options.taskId)
    }
    return result
  })
}
