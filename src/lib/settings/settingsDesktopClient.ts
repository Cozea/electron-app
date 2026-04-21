export const settingsDesktopClient = {
  hasSettings: () => Boolean(window.electronAPI?.settings),
  hasDialog: () => Boolean(window.electronAPI?.dialog),
  get: () => window.electronAPI.settings.get(),
  set: (settings: Parameters<typeof window.electronAPI.settings.set>[0]) =>
    window.electronAPI.settings.set(settings),
  selectDirectory: (
    options?: Parameters<typeof window.electronAPI.dialog.selectDirectory>[0]
  ) => window.electronAPI.dialog.selectDirectory(options),
  showMessageBox: (
    options: Parameters<typeof window.electronAPI.dialog.showMessageBox>[0]
  ) => window.electronAPI.dialog.showMessageBox(options),
}
