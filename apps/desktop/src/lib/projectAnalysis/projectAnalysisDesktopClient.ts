export const projectAnalysisDesktopClient = {
  listFiles: (options: Parameters<typeof window.electronAPI.project.listFiles>[0]) =>
    window.electronAPI.project.listFiles(options),
  readFile: (options: Parameters<typeof window.electronAPI.project.readFile>[0]) =>
    window.electronAPI.project.readFile(options),
  listDirectory: (options: Parameters<typeof window.electronAPI.project.listDirectory>[0]) =>
    window.electronAPI.project.listDirectory(options),
  resolveRoot: (workspaceId: Parameters<typeof window.electronAPI.project.resolveRoot>[0]) =>
    window.electronAPI.project.resolveRoot(workspaceId),
  getProjectCapabilities: (
    options: Parameters<typeof window.electronAPI.runtime.getProjectCapabilities>[0]
  ) => window.electronAPI.runtime.getProjectCapabilities(options),
}
