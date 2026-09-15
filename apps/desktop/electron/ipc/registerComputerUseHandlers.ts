import { shell, type IpcMain } from 'electron'
import { ComputerUseRuntimeService } from '../services/ComputerUseRuntimeService'
import type { AppSettings } from '../../../../shared/electronApiTypes'

export function registerComputerUseHandlers(
  ipcMain: IpcMain,
  _deps: { loadSettings: () => AppSettings }
): void {
  const service = ComputerUseRuntimeService.getInstance()

  ipcMain.handle('computerUse:getDiagnostics', async () => service.getDiagnostics())

  ipcMain.handle(
    'computerUse:openPermissionSettings',
    async (_event, target: 'accessibility' | 'screenRecording') => {
      if (process.platform !== 'darwin') return

      // TCC grants attach to the embedded driver's own code identity
      // (Developer ID Application: Cua AI, Inc.), because the supervised
      // driver process — not Cozea — invokes the Accessibility and
      // ScreenCapture APIs. The status check below queries the running
      // embedded daemon; when a grant is missing, the user enables the
      // driver's entry in System Settings.
      const granted = await service.requestPermission(target)
      if (granted) return

      const url =
        target === 'accessibility'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
          : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      await shell.openExternal(url)
    }
  )
}
