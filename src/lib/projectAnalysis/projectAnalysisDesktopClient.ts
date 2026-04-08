export const projectAnalysisDesktopClient = {
  listFiles: (options: Parameters<typeof window.electronAPI.project.listFiles>[0]) =>
    window.electronAPI.project.listFiles(options),
  readFile: (options: Parameters<typeof window.electronAPI.project.readFile>[0]) =>
    window.electronAPI.project.readFile(options),
  readDir: (path: Parameters<typeof window.electronAPI.fs.readDir>[0]) =>
    window.electronAPI.fs.readDir(path),
  getProjectCapabilities: (
    options: Parameters<typeof window.electronAPI.runtime.getProjectCapabilities>[0]
  ) => window.electronAPI.runtime.getProjectCapabilities(options),
}
