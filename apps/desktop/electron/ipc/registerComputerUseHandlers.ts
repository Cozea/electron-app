import type { IpcMain } from 'electron'
import { ComputerUseService } from '../services/ComputerUseService'
import type { AppSettings } from '../../../../shared/electronApiTypes'

export function registerComputerUseHandlers(
  ipcMain: IpcMain,
  deps: { loadSettings: () => AppSettings }
): void {
  const service = ComputerUseService.getInstance()

  ipcMain.handle('computerUse:getDiagnostics', async () => {
    const settings = deps.loadSettings()
    return service.getDiagnostics(settings.computerUseCliPath)
  })

  ipcMain.handle(
    'computerUse:openPermissionSettings',
    async (_event, target: 'accessibility' | 'screenRecording') => {
      return service.openPermissionSettings(target)
    }
  )
}
