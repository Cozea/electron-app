export const projectOpenDesktopClient = {
  createFolder: (options: {
    slug: string
    initGit?: boolean
    projectId?: string
    baseDirectory?: string
  }) => window.electronAPI.project.createFolder(options),
  getLocalPath: (options: {
    slug: string
    projectId: string
    localPathHint?: string | null
    attachedPathHint?: string | null
  }) =>
    window.electronAPI.project.getLocalPath(options),
  rememberLocalPath: (options: { projectId: string; projectPath: string }) =>
    window.electronAPI.project.rememberLocalPath(options),
  listFiles: (options: { projectPath: string }) => window.electronAPI.project.listFiles(options),
  openFolder: (options: { projectPath: string }) => window.electronAPI.project.openFolder(options),
  showMessageBox: (options: Parameters<typeof window.electronAPI.dialog.showMessageBox>[0]) =>
    window.electronAPI.dialog.showMessageBox(options),
  getSettings: () => window.electronAPI.settings.get(),
  openSettings: (route: string) => window.electronAPI.window.openSettings(route),
  sync: {
    gitCloneIfMissing: (
      options: Parameters<typeof window.electronAPI.sync.gitCloneIfMissing>[0],
    ) => window.electronAPI.sync.gitCloneIfMissing(options),
    gitEnsureRepo: (options: Parameters<typeof window.electronAPI.sync.gitEnsureRepo>[0]) =>
      window.electronAPI.sync.gitEnsureRepo(options),
    gitStatus: (options: Parameters<typeof window.electronAPI.sync.gitStatus>[0]) =>
      window.electronAPI.sync.gitStatus(options),
    gitFetchMain: (options: Parameters<typeof window.electronAPI.sync.gitFetchMain>[0]) =>
      window.electronAPI.sync.gitFetchMain(options),
    gitClassifyRepoHealth: (
      options: Parameters<typeof window.electronAPI.sync.gitClassifyRepoHealth>[0],
    ) => window.electronAPI.sync.gitClassifyRepoHealth(options),
    gitSalvageReclone: (
      options: Parameters<typeof window.electronAPI.sync.gitSalvageReclone>[0],
    ) => window.electronAPI.sync.gitSalvageReclone(options),
    gitAdoptWorkspace: (
      options: Parameters<typeof window.electronAPI.sync.gitAdoptWorkspace>[0],
    ) => window.electronAPI.sync.gitAdoptWorkspace(options),
    gitPushMain: (options: Parameters<typeof window.electronAPI.sync.gitPushMain>[0]) =>
      window.electronAPI.sync.gitPushMain(options),
    gitCommitAll: (options: Parameters<typeof window.electronAPI.sync.gitCommitAll>[0]) =>
      window.electronAPI.sync.gitCommitAll(options),
    gitCaptureCheckpoint: (
      options: Parameters<typeof window.electronAPI.sync.gitCaptureCheckpoint>[0],
    ) => window.electronAPI.sync.gitCaptureCheckpoint(options),
    gitDiffCheckpoints: (
      options: Parameters<typeof window.electronAPI.sync.gitDiffCheckpoints>[0],
    ) => window.electronAPI.sync.gitDiffCheckpoints(options),
    gitReadCheckpointFilePair: (
      options: Parameters<typeof window.electronAPI.sync.gitReadCheckpointFilePair>[0],
    ) => window.electronAPI.sync.gitReadCheckpointFilePair(options),
    gitDeleteCheckpointRefs: (
      options: Parameters<typeof window.electronAPI.sync.gitDeleteCheckpointRefs>[0],
    ) => window.electronAPI.sync.gitDeleteCheckpointRefs(options),
    gitDeleteAllCheckpointRefs: (
      options: Parameters<typeof window.electronAPI.sync.gitDeleteAllCheckpointRefs>[0],
    ) => window.electronAPI.sync.gitDeleteAllCheckpointRefs(options),
    gitGetHeadDiffStats: (
      options: Parameters<typeof window.electronAPI.sync.gitGetHeadDiffStats>[0],
    ) => window.electronAPI.sync.gitGetHeadDiffStats(options),
    gitRestoreMain: (options: Parameters<typeof window.electronAPI.sync.gitRestoreMain>[0]) =>
      window.electronAPI.sync.gitRestoreMain(options),
    gitReplayLocalCommits: (
      options: Parameters<typeof window.electronAPI.sync.gitReplayLocalCommits>[0],
    ) => window.electronAPI.sync.gitReplayLocalCommits(options),
  },
};
