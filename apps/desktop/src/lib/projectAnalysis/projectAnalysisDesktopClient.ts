export const projectAnalysisDesktopClient = {
  listFiles: (options: Parameters<typeof window.electronAPI.project.listFiles>[0]) =>
    window.electronAPI.project.listFiles(options),
  readFile: (options: Parameters<typeof window.electronAPI.project.readFile>[0]) =>
    window.electronAPI.project.readFile(options),
  readAbsoluteFile: (path: Parameters<typeof window.electronAPI.fs.readFile>[0]) =>
    window.electronAPI.fs.readFile(path),
  readDir: (path: Parameters<typeof window.electronAPI.fs.readDir>[0]) =>
    window.electronAPI.fs.readDir(path),
  resolveRoot: (workspaceId: Parameters<typeof window.electronAPI.project.resolveRoot>[0]) =>
    window.electronAPI.project.resolveRoot(workspaceId),
  getProjectCapabilities: (
    options: Parameters<typeof window.electronAPI.runtime.getProjectCapabilities>[0]
  ) => window.electronAPI.runtime.getProjectCapabilities(options),
}
