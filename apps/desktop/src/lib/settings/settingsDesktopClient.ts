import { localSettings, saveLocalSettings } from './localSettings'

export const settingsDesktopClient = {
  hasSettings: () => Boolean(window.electronAPI?.settings),
  hasDialog: () => Boolean(window.electronAPI?.dialog),
  get: () => localSettings.ensure(),
  set: (settings: Parameters<typeof window.electronAPI.settings.set>[0]) =>
    saveLocalSettings(settings),
  selectDirectory: (
    options?: Parameters<typeof window.electronAPI.dialog.selectDirectory>[0]
  ) => window.electronAPI.dialog.selectDirectory(options),
  showMessageBox: (
    options: Parameters<typeof window.electronAPI.dialog.showMessageBox>[0]
  ) => window.electronAPI.dialog.showMessageBox(options),
}
