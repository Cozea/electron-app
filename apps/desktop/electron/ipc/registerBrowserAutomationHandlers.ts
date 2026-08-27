import type { IpcMain } from 'electron'

import {
  BrowserAutomationAdapter,
  createBrowserAutomationHostFromWorkbench,
} from '../browser-automation'
import type { WorkbenchBrowserService } from '../services/WorkbenchBrowserService'
import type {
  BrowserAutomationClickInput,
  BrowserAutomationNavigateInput,
  BrowserAutomationResult,
  BrowserAutomationSnapshot,
  BrowserAutomationStatus,
  BrowserAutomationTileInput,
  BrowserAutomationTypeInput,
} from '../../../../shared/browserAutomationTypes'
import type { BrowserAutomationHostTileState } from '../browser-automation'

interface RegisterBrowserAutomationHandlersDeps {
  service: WorkbenchBrowserService
}

export function registerBrowserAutomationHandlers(
  ipcMain: IpcMain,
  deps: RegisterBrowserAutomationHandlersDeps,
): void {
  const adapter = new BrowserAutomationAdapter({
    host: createBrowserAutomationHostFromWorkbench(deps.service),
  })

  ipcMain.handle(
    'browserAutomation:status',
    async (): Promise<BrowserAutomationResult<BrowserAutomationStatus>> => {
      return adapter.status()
    },
  )

  ipcMain.handle(
    'browserAutomation:navigate',
    async (
      _event,
      options: BrowserAutomationNavigateInput,
    ): Promise<BrowserAutomationResult<BrowserAutomationHostTileState>> => {
      return adapter.navigate(options)
    },
  )

  ipcMain.handle(
    'browserAutomation:snapshot',
    async (
      _event,
      options: BrowserAutomationTileInput,
    ): Promise<BrowserAutomationResult<BrowserAutomationSnapshot>> => {
      return adapter.snapshot(options)
    },
  )

  ipcMain.handle(
    'browserAutomation:click',
    async (
      _event,
      options: BrowserAutomationClickInput,
    ): Promise<BrowserAutomationResult<{ clicked: true }>> => {
      return adapter.click(options)
    },
  )

  ipcMain.handle(
    'browserAutomation:type',
    async (
      _event,
      options: BrowserAutomationTypeInput,
    ): Promise<BrowserAutomationResult<{ typed: true }>> => {
      return adapter.type(options)
    },
  )
}
