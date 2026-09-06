import type { IpcMain } from 'electron'

import { ComputerUseRuntimeService } from '../services/ComputerUseRuntimeService'
import type {
  ScheduledTaskDraft,
  ScheduledTaskRunReport,
  ScheduledTasksSnapshot,
} from '../../../../shared/scheduledTasks'
import type { AppSettings } from '../../../../shared/electronApiTypes'

interface LazyScheduledTaskService {
  list(): ScheduledTasksSnapshot['tasks']
  standaloneWorkspaceRoot(): string
  save(draft: ScheduledTaskDraft): unknown
  setEnabled(options: { taskId: string; enabled: boolean }): unknown
  markRun(report: ScheduledTaskRunReport): unknown
  markRunSeen(options: { taskId: string; runId: string }): unknown
  remove(options: { taskId: string }): unknown
}

type ScheduledTaskComputerUsePolicyAction = 'prepare' | 'clear'

interface ScheduledTaskRunControl extends ScheduledTaskRunReport {
  computerUsePolicy?: ScheduledTaskComputerUsePolicyAction
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

/**
 * Scheduled tasks are read on one page and written from it, so the store loads
 * on first use rather than at boot. Computer-use availability rides along with
 * the list because a computer-use task is inert while the setting is off, and
 * the page has to be able to say so.
 */
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
  ipcMain.handle('scheduledTasks:save', async (_event, draft: ScheduledTaskDraft) =>
    (await getScheduledTaskService()).save(draft),
  )
  ipcMain.handle(
    'scheduledTasks:setEnabled',
    async (_event, options: { taskId: string; enabled: boolean }) =>
      (await getScheduledTaskService()).setEnabled(options),
  )
  ipcMain.handle('scheduledTasks:markRun', async (_event, report: ScheduledTaskRunReport) => {
    const service = await getScheduledTaskService()
    const control = report as ScheduledTaskRunControl
    const threadId = reportThreadId(report)

    // The renderer only asks to prepare a scheduled thread. Main derives the
    // actual allow/deny decision from the persisted task so unattended desktop
    // authorization cannot be widened by a renderer-supplied boolean.
    if (control.computerUsePolicy === 'prepare') {
      if (!threadId) return { success: false, error: 'Scheduled task policy requires a thread.' }
      const task = service.list().find((candidate) => candidate.id === report.taskId)
      if (!task) return { success: false, error: 'That scheduled task no longer exists.' }
      if (task.computerUse && deps.loadSettings().computerUseEnabled !== true) {
        return { success: false, error: 'Computer Use is disabled in Settings.' }
      }
      ComputerUseRuntimeService.getInstance().setThreadPolicy(
        threadId,
        task.computerUse ? 'allow' : 'deny',
      )
      return { success: true, taskId: task.id }
    }

    if (control.computerUsePolicy === 'clear') {
      if (!threadId) return { success: false, error: 'Scheduled task policy requires a thread.' }
      ComputerUseRuntimeService.getInstance().clearThreadPolicy(threadId)
      return { success: true, taskId: report.taskId }
    }

    return service.markRun(report)
  })
  ipcMain.handle(
    'scheduledTasks:markRunSeen',
    async (_event, options: { taskId: string; runId: string }) =>
      (await getScheduledTaskService()).markRunSeen(options),
  )
  ipcMain.handle('scheduledTasks:remove', async (_event, options: { taskId: string }) =>
    (await getScheduledTaskService()).remove(options),
  )
}
