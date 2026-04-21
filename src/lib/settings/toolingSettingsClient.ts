export const toolingSettingsClient = {
  isAvailable: () => Boolean(window.electronAPI?.runtime?.getRuntimeStatus),
  getRuntimeStatus: (
    options?: Parameters<typeof window.electronAPI.runtime.getRuntimeStatus>[0]
  ) => window.electronAPI.runtime.getRuntimeStatus(options),
  getGitRuntimeHealth: () =>
    window.electronAPI?.sync?.getGitRuntimeHealth
      ? window.electronAPI.sync.getGitRuntimeHealth()
      : Promise.resolve(null),
}
