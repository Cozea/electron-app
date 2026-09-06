import { shell, type IpcMain } from 'electron'
import { ComputerUseRuntimeService } from '../services/ComputerUseRuntimeService'
import type { AppSettings } from '../../../../shared/electronApiTypes'

/**
 * Registers IPC handlers for Computer Use runtime operations including diagnostics
 * and permission management. Connects the renderer process to the native Computer
 * Use runtime service for macOS Accessibility and Screen Recording permissions.
 *
 * @param ipcMain - Electron IPC main interface for registering handlers
 * @param _deps - Dependencies object (currently unused)
 */
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

      // The permission request originates from the same signed Cozea process
      // that later calls Accessibility / ScreenCaptureKit through the loaded
      // OpenComputerUseKit bridge. This keeps TCC ownership on Cozea rather
      // than Terminal, Node, or a separately installed OCU app.
      const granted = service.requestPermission(target)
      if (granted) return

      const url =
        target === 'accessibility'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
          : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      await shell.openExternal(url)
    }
  )
}
