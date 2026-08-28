export const storageSettingsClient = {
  isAvailable: () => Boolean(window.electronAPI?.storage?.getSnapshot),
  getSnapshot: (
    options?: Parameters<typeof window.electronAPI.storage.getSnapshot>[0]
  ) => window.electronAPI.storage.getSnapshot(options),
  openProjectsDirectory: () => window.electronAPI.storage.openProjectsDirectory(),
  clearCache: () => window.electronAPI.storage.clearCache(),
  clearLogs: () => window.electronAPI.storage.clearLogs(),
  clearAll: () => window.electronAPI.storage.clearAll(),
}
