import type { IpcMain } from 'electron'

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

let servicePromise: Promise<LazyScheduledTaskService> | null = null

function getScheduledTaskService(): Promise<LazyScheduledTaskService> {
  servicePromise ??= import('../services/ScheduledTaskService').then(
    ({ ScheduledTaskService }) =>
      ScheduledTaskService.getInstance() as unknown as LazyScheduledTaskService,
  )
  return servicePromise
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
  ipcMain.handle('scheduledTasks:markRun', async (_event, report: ScheduledTaskRunReport) =>
    (await getScheduledTaskService()).markRun(report),
  )
  ipcMain.handle(
    'scheduledTasks:markRunSeen',
    async (_event, options: { taskId: string; runId: string }) =>
      (await getScheduledTaskService()).markRunSeen(options),
  )
  ipcMain.handle('scheduledTasks:remove', async (_event, options: { taskId: string }) =>
    (await getScheduledTaskService()).remove(options),
  )
}
