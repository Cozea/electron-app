import type { Session } from './types'
import type {
  NativePreviewActionResult,
  NativePreviewCaptureScreenshotRequest,
  NativePreviewCaptureScreenshotResult,
  NativePreviewListIosSimulatorsResult,
  NativePreviewResolveLaunchConfigRequest,
  NativePreviewResolveLaunchConfigResult,
  NativePreviewRotateRequest,
  NativePreviewSendButtonRequest,
  NativePreviewSendKeyRequest,
  NativePreviewSendTouchesRequest,
  NativePreviewSendWheelRequest,
  NativePreviewSessionLocator,
  NativePreviewSessionState,
  NativePreviewStartSessionRequest,
  NativePreviewStartSessionResult,
  NativePreviewStateChangedEvent,
  NativePreviewStopSessionRequest,
  NativePreviewStopSessionResult,
} from './nativePreviewTypes'

export type {
  PersonalWorkspaceMembership,
  Session,
  User,
  WorkspaceMembership,
} from './types'

export interface AppSettings {
  projectsDirectory: string
  previewHeaderCompatibilityEnabled: boolean
  approvedExternalReadRoots?: string[]
  deactivateTransparency?: boolean
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseName?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

export interface GpuAccelerationDiagnostics {
  hardwareAccelerationEnabled: boolean
  featureStatus: Record<string, string>
  gpuCompositing: string | null
  webgl: string | null
  webgl2: string | null
  rasterization: string | null
  videoDecode: string | null
  updatedAt: number
}

export interface StorageUsage {
  projects: number
  dependencies: number
  buildCache: number
  logs: number
  total: number
  diskTotal: number
  diskFree: number
}

export interface ProjectPathNativeIconResult {
  success: boolean
  dataUrl?: string
  error?: string
}

export interface LocalProject {
  name: string
  path: string
  size: number
  lastModified: number
}

export interface ProjectLocalPathLookupOptions {
  slug: string
  projectId?: string
  localPathHint?: string | null
  attachedPathHint?: string | null
}

export interface StorageProjectsPage {
  items: LocalProject[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface StorageSnapshot {
  projectsDirectory: string
  usage: StorageUsage
  projects: StorageProjectsPage
  updatedAt: number
  fromCache: boolean
}

export interface StorageActionResult {
  success: boolean
  error?: string
  clearedBytes?: number
  deletedCount?: number
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

// Current release supports web target only.
// Reserved for future use (not yet enabled): 'desktop' | 'mobile'.
export type TargetPlatform = 'web'

export interface BuildContract {
  previewMode: 'web'
  frameworkClass: 'web-framework'
  toolchain?: Record<string, unknown>
  commands?: Record<string, unknown>
  constraints?: Record<string, unknown>
  fallbackPolicy?: Record<string, unknown>
  successCriteria?: Record<string, unknown>
  telemetryHints?: Record<string, unknown>
}

export type RuntimeKind =
  | 'node'
  | 'npm'
  | 'corepack'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'python'
  | 'rust'
  | 'go'

export type RuntimeSource = 'override' | 'system' | 'missing'
export type RuntimeTarget = `${NodeJS.Platform}-${NodeJS.Architecture}` | string

export interface RuntimeHealth {
  runtime: RuntimeKind
  target: RuntimeTarget
  source: RuntimeSource
  available: boolean
  executablePath?: string
  version?: string
  error?: string
}

export interface RuntimeEnsureResult {
  success: boolean
  runtime: RuntimeKind
  target: RuntimeTarget
  source: RuntimeSource
  executablePath?: string
  installed?: boolean
  error?: string
}

export interface DevCommandSuggestion {
  command: string
  runtime: RuntimeKind | 'unknown'
  confidence: number
  reason: string
}

export interface DevServerConfig {
  suggestions: DevCommandSuggestion[]
  selectedCommand?: string
  requiresUserSelection: boolean
}

export interface ProjectRuntimeProfile {
  runtimes: RuntimeHealth[]
  devServer: DevServerConfig
  evidence: {
    files: string[]
    scripts: string[]
    lockfiles: string[]
  }
}

export interface RuntimeResolveCommandResult {
  success: boolean
  command: string
  resolvedCommand?: string
  runtime?: RuntimeKind
  source?: RuntimeSource
  executablePath?: string
  status?: 'completed' | 'failed' | 'needs_user_approval'
  approvalPayload?: {
    command: string
    reason: string
    alternatives: string[]
  }
  error?: string
}

export interface CreateProjectFolderResult {
  success: boolean
  localPath?: string
  error?: string
}

export interface GhCliStatus {
  available: boolean
  username?: string
  error?: string
}

export interface CreateGitHubRepoResult {
  success: boolean
  repoUrl?: string
  error?: string
}

export interface CloneRepositoryResult {
  success: boolean
  localPath?: string
  normalizedRepoUrl?: string
  error?: string
}

export interface RepositoryOwnerDescriptor {
  id: string
  login: string
  displayName: string
  kind: 'user' | 'organization' | 'group'
  installationId?: string
  installationTargetType?: 'user' | 'organization'
  installationTargetLogin?: string
  installationTargetName?: string
}

export interface RepositoryDescriptor {
  id: string
  name: string
  fullName: string
  ownerLogin: string
  ownerId?: string
  ownerAvatarUrl?: string
  lastActivityAt?: string
  defaultBranch?: string
  private: boolean
  visibility?: 'public' | 'private' | 'internal'
  url: string
  provider: 'github' | 'gitlab'
  canAdmin?: boolean
  sizeBytes?: number
  starsCount?: number
  description?: string
  language?: string
}

export interface RepositoryBranchDescriptor {
  name: string
  isDefault: boolean
}

export interface RepositoryLanguageDescriptor {
  name: string
  percentage: number
}

export interface RepositoryReadmeSnippetDescriptor {
  excerpt: string | null
}

export interface RepositoryListPageResult {
  items: RepositoryDescriptor[]
  hasNextPage: boolean
  nextPage?: number
}

export interface CopyDirectorySnapshotResult {
  success: boolean
  copiedTo?: string
  error?: string
}

export interface ImportSourcePreflightIssue {
  path: string
  reason: 'likely-offline-placeholder'
}

export interface ImportSourcePreflightResult {
  success: boolean
  scannedFiles?: number
  issues?: ImportSourcePreflightIssue[]
  truncated?: boolean
  error?: string
}

export interface ProjectLaneDescriptor {
  id: string
  name: string
  branch: string
  projectPath: string
  isCollab: boolean
  createdAt: number
  updatedAt: number
}

export interface ProjectLaneState {
  activeLaneId: string | null
  collabLaneId: string
  lanes: ProjectLaneDescriptor[]
}

export interface ProjectGitBranchDescriptor {
  name: string
  isRemote?: boolean
  remoteName?: string
  current: boolean
  isDefault: boolean
  worktreePath: string | null
}

export interface ProjectGitBranchListResult {
  isRepo: boolean
  hasOriginRemote: boolean
  branches: ProjectGitBranchDescriptor[]
  error?: string
}

export interface ProjectGitCheckoutResult {
  success: boolean
  branch?: string
  error?: string
}

export interface ProjectGitCreateWorktreeResult {
  success: boolean
  worktree?: {
    path: string
    branch: string
  }
  error?: string
}

export interface WriteFileResult {
  success: boolean
  fullPath?: string
  sizeBytes?: number
  error?: string
}

export interface ReadFileResult {
  success: boolean
  content?: string
  sizeBytes?: number
  error?: string
}

export interface ReadFileBase64Result {
  success: boolean
  base64?: string
  sizeBytes?: number
  error?: string
}

export interface ListFilesResult {
  success: boolean
  files?: { path: string; sizeBytes: number }[]
  error?: string
}

export type ProjectFrameworkId =
  | 'expo'
  | 'react-native'
  | 'nextjs'
  | 'remix'
  | 'vite-react'
  | 'vite-vue'
  | 'vite-svelte'
  | 'cra'
  | 'sveltekit'
  | 'nuxt'
  | 'astro'
  | 'gatsby'
  | 'angular'
  | 'solid-start'
  | 'qwik'
  | 'unknown'

export type ProjectRouteConvention = 'file-based' | 'config-based' | 'unknown'

export interface ProjectStoredFrameworkInfo {
  framework?: string | null
  devCommand?: string | null
  devPort?: number | null
}

export interface ProjectScannedRoute {
  name: string
  path: string
  file: string
  type: 'static' | 'dynamic'
  description?: string
}

export interface ProjectRouteScanResult {
  success: boolean
  routes: ProjectScannedRoute[]
  framework: ProjectFrameworkId
  frameworkDisplayName: string
  routeConvention: ProjectRouteConvention
  error?: string
}

export interface ProjectContextOptionsResult extends ProjectRouteScanResult {
  files: string[]
}

export interface RenameFileResult {
  success: boolean
  error?: string
}

export type PreviewFailureReason =
  | 'none'
  | 'blocked_response'
  | 'chrome_error_document'
  | 'frame_not_found'
  | 'bridge_injection_failed'
  | 'bridge_timeout'
  | 'iframe_load_error'
  | 'network_quality_degraded'
  | 'server_unreachable'
  | 'invalid_url'
  | 'unsupported_origin'
  | 'window_unavailable'
  | 'unknown'

export interface PreviewHeaderDiagnostic {
  url: string
  resourceType: 'mainFrame' | 'subFrame'
  compatibilityEnabled: boolean
  rewritten: boolean
  removed: string[]
  ensured?: string[]
  capturedAt: number
}

export interface PreviewBridgeFrameDetails {
  requestedFrameName?: string
  matchedFrameName?: string
  matchedFrameUrl?: string
  frameHref?: string | null
  frameTreeNodeId?: number
  routingId?: number
  availableFrames?: Array<{
    name: string
    url: string
    frameTreeNodeId: number
    routingId: number
  }>
}

export interface PreviewInjectBridgeResult {
  success: boolean
  error?: string
  reason?: PreviewFailureReason
  likelyBlocked?: boolean
  frame?: PreviewBridgeFrameDetails
  headerDiagnostic?: PreviewHeaderDiagnostic | null
}

export interface PreviewProbeUrlResult {
  success: boolean
  url: string
  reachable: boolean
  statusCode?: number
  finalUrl?: string
  reason?: PreviewFailureReason
  error?: string
  elapsedMs: number
}

export interface PreviewProbePortResult {
  success: boolean
  port: number
  reachable: boolean
  error?: string
  elapsedMs: number
}

export interface PreviewCaptureScreenshotResult {
  success: boolean
  base64?: string
  error?: string
}

export interface PreviewInspectorSelectionInput {
  url: string
  frameName?: string
  bridgeInstanceId?: string
  selector?: string
  path?: number[]
}

export interface PreviewInspectorElementSnapshot {
  tagName: string
  className: string
  id?: string
  selector: string
  path: number[]
  boundingRect: {
    x: number
    y: number
    width: number
    height: number
  }
  computedStyles: Record<string, string>
  inlineStyles: Record<string, string>
  htmlSnippet: string
  textContent?: string
}

export interface PreviewInspectorSelectionResult {
  success: boolean
  snapshot?: PreviewInspectorElementSnapshot
  error?: string
}

export interface PreviewInspectorStyleMutationInput extends PreviewInspectorSelectionInput {
  styles: Record<string, string>
}

export interface PreviewInspectorTextMutationInput extends PreviewInspectorSelectionInput {
  text: string
}

export interface PreviewInspectorMutationResult {
  success: boolean
  snapshot?: PreviewInspectorElementSnapshot
  error?: string
}

export interface WatchProjectResult {
  success: boolean
  error?: string
}

export interface FileManifestEntry {
  path: string
  hash: string
  size: number
  mtime: number
}

export interface SyncWriteFilesResult {
  results: Array<{ path: string; success: boolean; error?: string }>
  successCount: number
}

export interface SyncWriteFile {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface GitRuntimeHealth {
  available: boolean
  executablePath?: string
  source: 'system' | 'missing'
  gitVersion?: string
  supportsMergeFile: boolean
  supportsZdiff3: boolean
  supportsMergeTree: boolean
  supportsMergeTreeWriteTree: boolean
  preflightCheckedAt: number
  preflightOk: boolean
  error?: string
}

export interface MergePreviewResult {
  success: boolean
  mergedContent: string
  hasConflicts: boolean
  conflictCount: number
  strategyUsed: 'zdiff3' | 'diff3'
  gitVersion: string
  error?: string
}

export interface MergeTreePreviewResult {
  success: boolean
  clean: boolean
  treeOid?: string
  conflicts: Array<{ path: string; message?: string }>
  mergedFiles: Array<{ path: string; content: string }>
  gitVersion: string
  rawOutput?: string
  error?: string
}

export interface GitSyncEnsureRepoResult {
  success: boolean
  isRepo: boolean
  initialized?: boolean
  currentBranch?: string
  topLevelPath?: string
  gitDir?: string
  error?: string
}

export interface GitSyncCloneResult {
  success: boolean
  cloned?: boolean
  localPath?: string
  currentBranch?: string
  headCommit?: string
  remoteUrl?: string
  error?: string
}

export interface GitSyncFetchResult {
  success: boolean
  remote?: string
  branch?: string
  currentBranch?: string
  upstreamRef?: string
  headCommit?: string
  error?: string
}

export interface GitSyncStatusResult {
  success: boolean
  repoExists: boolean
  isRepo: boolean
  gitDir?: string
  topLevelPath?: string
  currentBranch?: string
  headCommit?: string
  upstreamBranch?: string | null
  clean?: boolean
  ahead?: number
  behind?: number
  hasConflicts?: boolean
  hasStagedChanges?: boolean
  hasUnstagedChanges?: boolean
  hasUntrackedChanges?: boolean
  deletedCount?: number
  changedPaths?: string[]
  conflictedPaths?: string[]
  error?: string
}

export interface GitSyncPullResult {
  success: boolean
  remote?: string
  branch?: string
  strategy: 'merge' | 'ff-only'
  currentBranch?: string | null
  headCommit?: string
  alreadyUpToDate?: boolean
  hadConflicts?: boolean
  conflictedPaths?: string[]
  fastForward?: boolean
  error?: string
}

export interface GitSyncReplayResult {
  success: boolean
  remote?: string
  branch?: string
  currentBranch?: string | null
  headCommit?: string
  replayedCommitCount?: number
  replayedCommits?: string[]
  hadConflicts?: boolean
  conflictedPaths?: string[]
  error?: string
}

export type GitRepoHealthState =
  | 'healthy'
  | 'dirty'
  | 'diverged'
  | 'merge_in_progress'
  | 'cherry_pick_in_progress'
  | 'rebase_in_progress'
  | 'detached_head'
  | 'index_locked'
  | 'unrelated_history'
  | 'broken'

export interface GitRepoHealthResult {
  success: boolean
  health?: GitRepoHealthState
  currentBranch?: string | null
  headCommit?: string
  error?: string
}

export interface GitSyncSalvageResult {
  success: boolean
  localPath?: string
  backupPath?: string
  currentBranch?: string | null
  headCommit?: string
  error?: string
}

export interface GitConflictFileResult {
  success: boolean
  filePath: string
  currentContent?: string
  baseContent?: string | null
  localContent?: string | null
  cloudContent?: string | null
  error?: string
}

export interface GitResolveConflictResult {
  success: boolean
  filePath: string
  remainingConflictedPaths?: string[]
  mergeCompleted?: boolean
  error?: string
}

export interface GitSyncRestoreResult {
  success: boolean
  remote?: string
  branch?: string
  currentBranch?: string | null
  headCommit?: string
  restored?: boolean
  error?: string
}

export interface GitSyncAdoptResult {
  success: boolean
  currentBranch?: string | null
  headCommit?: string
  commitCreated?: boolean
  error?: string
}

export interface GitSyncCommitResult {
  success: boolean
  currentBranch?: string | null
  commitCreated?: boolean
  commitSha?: string
  error?: string
}

export interface GitSyncPushResult {
  success: boolean
  remote?: string
  branch?: string
  currentBranch?: string | null
  headCommit?: string
  pushed?: boolean
  error?: string
}

export interface GitSyncCommitPushResult {
  success: boolean
  remote?: string
  branch?: string
  currentBranch?: string
  commitCreated?: boolean
  pushed?: boolean
  commitSha?: string
  error?: string
}

export interface GitCheckpointCaptureResult {
  success: boolean
  ref?: string
  commitOid?: string
  error?: string
}

export interface GitCheckpointDiffResult {
  success: boolean
  diff?: string
  error?: string
}

export interface GitCheckpointFilePairResult {
  success: boolean
  previousContent?: string
  nextContent?: string
  error?: string
}

export interface GitCheckpointDeleteResult {
  success: boolean
  deletedRefs?: string[]
  error?: string
}

export interface GitCheckpointHeadStatsResult {
  success: boolean
  additions: number
  deletions: number
  changedFiles: number
  error?: string
}

export type GitChangesScope = 'current' | 'branch'

export type GitChangeFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface GitChangeFileSummary {
  path: string
  oldPath?: string
  status: GitChangeFileStatus
}

export interface GitChangesListResult {
  success: boolean
  scope: GitChangesScope
  files: GitChangeFileSummary[]
  baseRef?: string
  headRef?: string
  error?: string
}

export interface GitChangesPatchResult {
  success: boolean
  scope: GitChangesScope
  diff?: string
  baseRef?: string
  headRef?: string
  error?: string
}

export interface GitChangesResult {
  success: boolean
  scope: GitChangesScope
  files: GitChangeFileSummary[]
  diff?: string
  baseRef?: string
  headRef?: string
  error?: string
}

export interface SyncOp {
  opId: string
  idempotencyKey: string
  projectId: string
  actorId: string
  actorType: 'user' | 'agent' | 'system'
  source: 'editor' | 'agent' | 'watcher' | 'remote'
  kind: 'upsert' | 'delete' | 'rename' | 'chmod' | 'yjs_update'
  path: string
  baseHash?: string
  newHash?: string
  isBinary: boolean
  size: number
  timestamp: number
}

export interface SyncJournalState {
  projectId: string
  journalHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: number
  pathHeads: Record<string, string>
  lastJournalCursor: number
  lastPersistedAt: number | null
}

export interface SyncDeleteFilesResult {
  results: Array<{ path: string; success: boolean }>
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

export interface TerminalProfile {
  id: string
  name: string
  path: string
  args?: string[]
  env?: Record<string, string>
  icon?: string
}

export interface TerminalInfo {
  id: string
  profileId: string
  profileName: string
  title: string
}

export interface TerminalSnapshot {
  id: string
  projectPath: string
  runId?: string
  command?: string
  stdout: string
  stderr: string
  outputSequence: number
  updatedAt: number
  exitCode: number | null
  running: boolean
  startedAt: number
  endedAt: number | null
  timedOut: boolean
  cancelled: boolean
}

export type TerminalActivityTrackingMode = 'off' | 'subprocess'
export type TerminalKind = 'shell' | 'dev-server' | 'agent' | 'task'
export type FileChangeActorType = 'user' | 'agent' | 'system'
export type FileChangeOriginKind = 'user' | 'agent' | 'remote' | 'init'

export interface FileChangeAttribution {
  origin: FileChangeOriginKind
  sourceOrigin?: string
  actorType?: FileChangeActorType
  actorId?: string
  userId?: string
  userName?: string
  clientId?: string
  terminalId?: string
  terminalTitle?: string
  terminalKind?: TerminalKind | string
  commandId?: string
  commandText?: string
  runId?: string
  sessionKey?: string
  laneId?: string
  workspaceId?: string
  gitCwd?: string
  checkpointGroupId?: string
  timestamp?: number
}

export interface GitDirtyStateSnapshot {
  projectPath: string
  additions: number
  deletions: number
  changedFiles: number
  computedAt: number
  error?: string
}

export interface TerminalCreateOptions {
  projectPath: string
  profileId?: string
  cwd?: string
  cols?: number
  rows?: number
  runId?: string
  env?: Record<string, string>
  activityTracking?: TerminalActivityTrackingMode
  sessionKey?: string
  laneId?: string
  workspaceId?: string
  gitCwd?: string
  terminalKind?: TerminalKind
}

export interface TerminalAttachViewOptions {
  terminalId: string
  cols: number
  rows: number
}

export interface TerminalDetachViewOptions {
  terminalId: string
}

export interface TerminalAttachViewResult {
  success: boolean
  snapshot: TerminalSnapshot | null
  replayEvents: TerminalOutputEvent[]
}

export interface TerminalOutputEvent {
  terminalId: string
  data: string
  sequence: number
  createdAt: number
  historyData?: string
  runId?: string
}

export interface TerminalActivityEvent {
  terminalId: string
  hasRunningSubprocess: boolean
  runId?: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number | null
  runId?: string
}

export type AgentToolId = 'claude' | 'gemini' | 'kilo' | 'shell' | 'copilot' | 'codex'

export type AgentToolSource = 'builtin' | 'system' | 'managed' | 'missing'

export interface AgentToolStatus {
  toolId: AgentToolId
  label: string
  available: boolean
  source: AgentToolSource
  packageName?: string
  commandPath?: string
  launchCommand?: string
  installRoot?: string
  updatedAt?: number
  error?: string
}

export interface AgentToolPrepareResult extends AgentToolStatus {
  success: boolean
}

export interface DevServerStartOptions {
  projectPath: string
  command: string
  bootstrapCommand?: string | null
  port: number
  sessionKey?: string | null
  framework?: string | null
  terminalId: string
  cols?: number
  rows?: number
  runId?: string
}

export interface DevServerStartResult {
  success: boolean
  port?: number
  pid?: number
  runId?: string
  existing?: boolean
  error?: string
}

export interface DevServerOutputEvent {
  projectPath: string
  output: string
  stream: 'stdout' | 'stderr'
  runId?: string
}

export interface DevServerExitEvent {
  projectPath: string
  code: number | null
  runId?: string
}

export interface IntegrationKeyResult {
  success: boolean
  keyId?: string
  keyData?: string
  error?: string
}

export interface IntegrationEncryptResult {
  success: boolean
  encrypted?: string
  error?: string
}

export interface IntegrationDecryptResult {
  success: boolean
  credentials?: Record<string, unknown>
  error?: string
}

export interface IntegrationToolDefinition {
  provider: string
  name: string
  displayName: string
  command: string
  description: string
}

export interface IntegrationToolResult {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number | null
  timedOut?: boolean
  error?: string
}

export interface CollabDeviceIdentity {
  deviceId: string
  deviceLabel: string
  platform: string
  publicKeyAlgorithm: string
  fingerprint: string
  publicKeyJwk: string
}

export interface CollabWrappedRoomKeyResult {
  wrappedKey: string
  wrapAlgorithm: string
  senderPublicKeyJwk: string
  senderDeviceId: string
}

export interface CollabRecoveryKitResult {
  recoveryCode: string
  wrappedKey: string
  wrapAlgorithm: string
  salt: string
  iterations: number
}

export interface LocalAiRuntimeStatus {
  enabled: boolean
  running: boolean
  endpoint?: string
}

export type ElectronWindowContext = 'main' | 'settings'

export type AuthRefreshFailureReason = 'expired' | 'retryable' | 'missing_session'

export type ExternalBrowserId =
  | 'system'
  | 'safari'
  | 'chrome'
  | 'arc'
  | 'firefox'
  | 'edge'
  | 'brave'

export interface AvailableExternalBrowser {
  id: ExternalBrowserId
  name: string
}

export interface AvailableExternalBrowserResult {
  browsers: AvailableExternalBrowser[]
  defaultBrowserId: ExternalBrowserId
}

export type ExternalEditorId =
  | 'cozea'
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf'
  | 'vscodium'
  | 'zed'
  | 'antigravity'
  | 'webstorm'
  | 'intellij-idea'
  | 'phpstorm'
  | 'pycharm'
  | 'rider'
  | 'goland'
  | 'rubymine'
  | 'clion'
  | 'datagrip'

export interface AvailableExternalEditor {
  id: ExternalEditorId
  name: string
}

export type AuthRefreshResult =
  | {
      ok: true
      session: Session
    }
  | {
      ok: false
      reason: AuthRefreshFailureReason
      statusCode?: number
    }

export interface WorkbenchBrowserViewState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon?: string | null
  focused: boolean
  visible: boolean
  isDevToolsOpen: boolean
  storageScope: import('./browserHostTypes').BrowserStorageScope
  zoomFactor: number
  canZoomIn: boolean
  canZoomOut: boolean
  find: import('./browserHostTypes').BrowserFindState
  loadError?: string | null
}

export type WorkbenchSessionLifecycle =
  | 'active'
  | 'backgroundWarm'
  | 'backgroundFrozen'
  | 'closed'

export interface WorkbenchSessionDevServerState {
  running: boolean
  port: number | null
  runId: string | null
}

export interface WorkbenchSessionSnapshot {
  sessionKey: string
  projectId: string
  laneId: string
  projectPath: string | null
  lifecycle: WorkbenchSessionLifecycle
  pinned: boolean
  openedAt: number
  lastFocusedAt: number
  lastBackgroundedAt: number | null
  terminalBindings: Record<string, string>
  devServer: WorkbenchSessionDevServerState
  hasBrowserSurface: boolean
  hasNativePreviewSession: boolean
}

export interface ElectronAPI {
  platform: NodeJS.Platform
  windowContext: ElectronWindowContext
  localAiRuntime: {
    getStatus: () => Promise<LocalAiRuntimeStatus>
  }
  integrations: {
    isEncryptionAvailable: () => Promise<boolean>
    generateKey: () => Promise<IntegrationKeyResult>
    storeKey: (options: { keyId: string; keyData: string }) => Promise<{ success: boolean; error?: string }>
    deleteKey: (options: { keyId: string }) => Promise<{ success: boolean; error?: string }>
    keyExists: (options: { keyId: string }) => Promise<boolean>
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) => Promise<IntegrationEncryptResult>
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
    }) => void) => () => void
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => () => void
    startOAuth: (options: { provider: string; orgId: string; metadata?: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>
    runTool: (options: {
      toolName: string
      args: string[]
      workingDir: string
      encryptedCredentials: string
      keyId: string
      timeout?: number
    }) => Promise<IntegrationToolResult>
    isToolAvailable: (options: { toolName: string }) => Promise<boolean>
    getToolDefinition: (options: { toolName: string }) => Promise<IntegrationToolDefinition | null>
    listTools: () => Promise<IntegrationToolDefinition[]>
  }
  collab: {
    isEncryptionAvailable: () => Promise<boolean>
    ensureDeviceIdentity: () => Promise<CollabDeviceIdentity>
    getStoredDeviceIdentity: () => Promise<CollabDeviceIdentity | null>
    wrapRoomKey: (options: {
      roomKeyBase64: string
      recipientPublicKeyJwk: string
    }) => Promise<CollabWrappedRoomKeyResult>
    unwrapRoomKey: (options: {
      senderPublicKeyJwk: string
      wrappedKey: string
      wrapAlgorithm?: string
    }) => Promise<{ roomKeyBase64: string }>
    createRecoveryKit: (options: {
      roomKeyBase64: string
      recoveryCode?: string
    }) => Promise<CollabRecoveryKitResult>
    unwrapRecoveryKit: (options: {
      recoveryCode: string
      wrappedKey: string
      salt: string
      iterations: number
      wrapAlgorithm?: string
    }) => Promise<{ roomKeyBase64: string }>
    deleteDeviceIdentity: () => Promise<{ success: boolean; error?: string }>
  }
  tools: {
    run: (request: {
      name: string
      input: Record<string, unknown>
      projectPath?: string
      runId?: string
      toolCallId?: string
    }) => Promise<{ success: boolean; output?: unknown; error?: string }>
    cancel: (request: { runId: string }) => Promise<{ success: boolean; canceled?: number; error?: string }>
  }
  shell: {
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    listAvailableBrowsers: () => Promise<AvailableExternalBrowserResult>
    openInBrowser: (options: { url: string; browserId?: ExternalBrowserId }) => Promise<{ success: boolean; error?: string }>
  }
  editor: {
    listAvailableEditors: () => Promise<AvailableExternalEditor[]>
    openInEditor: (options: {
      editorId: ExternalEditorId
      filePath: string
      line?: number
      column?: number
    }) => Promise<{ success: boolean; error?: string }>
  }
  app: {
    onNavigate: (callback: (path: string) => void) => () => void
    onOpenSettings: (callback: (route: string) => void) => () => void
    getGpuDiagnostics: () => Promise<GpuAccelerationDiagnostics>
    setNativeThemeSource: (source: 'system' | 'light' | 'dark') => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
  }
  dialog: {
    selectDirectory: (options?: {
      title?: string
    }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
    selectFile: (options: {
      title?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
    showMessageBox: (options: import('electron').MessageBoxOptions) => Promise<import('electron').MessageBoxReturnValue>
  }
  storage: {
    getSnapshot: (options?: { page?: number; pageSize?: number; forceRefresh?: boolean }) => Promise<StorageSnapshot>
    getUsage: () => Promise<StorageUsage>
    listProjects: () => Promise<LocalProject[]>
    openProjectsDirectory: () => Promise<StorageActionResult>
    clearCache: () => Promise<StorageActionResult>
    clearLogs: () => Promise<StorageActionResult>
    deleteProject: (options: { projectPath: string }) => Promise<StorageActionResult>
    clearAll: () => Promise<StorageActionResult>
  }
  window: {
    isFullScreen: () => Promise<boolean>
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void
    openSettings: (route?: string) => Promise<{ success: boolean; error?: string }>
  }
  workbenchBrowser: {
    ensureTile: (options: {
      tileId: string
      initialUrl?: string
      storageScope?: import('./browserHostTypes').BrowserStorageScope
      workspaceId?: string
    }) => Promise<WorkbenchBrowserViewState>
    destroyTile: (options: { tileId: string }) => Promise<boolean>
    setBounds: (options: {
      tileId: string
      bounds?: { x: number; y: number; width: number; height: number }
      visible?: boolean
    }) => Promise<boolean>
    navigate: (options: { tileId: string; url: string }) => Promise<WorkbenchBrowserViewState | null>
    getState: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    goBack: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    goForward: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    reload: (options: { tileId: string; hard?: boolean }) => Promise<WorkbenchBrowserViewState | null>
    focus: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    toggleDevTools: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    openExternal: (options: { tileId: string }) => Promise<{ success: boolean; error?: string }>
    zoomIn: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    zoomOut: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    resetZoom: (options: { tileId: string }) => Promise<WorkbenchBrowserViewState | null>
    findInPage: (options: {
      tileId: string
      text: string
      forward?: boolean
      recompute?: boolean
      matchCase?: boolean
    }) => Promise<WorkbenchBrowserViewState | null>
    stopFindInPage: (options: { tileId: string; keepSelection?: boolean }) => Promise<WorkbenchBrowserViewState | null>
    getSelectedText: (options: { tileId: string }) => Promise<string>
    captureScreenshot: (options: { tileId: string }) => Promise<string | null>
    onStateChange: (callback: (state: WorkbenchBrowserViewState) => void) => () => void
    onNewPageRequest: (callback: (request: import('./browserHostTypes').BrowserNewPageRequest) => void) => () => void
    onCommand: (callback: (command: import('./browserHostTypes').BrowserUiCommand) => void) => () => void
  }
  workbenchSession: {
    ensureSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      projectPath?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    activateSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      projectPath?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    backgroundSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      mode?: Exclude<WorkbenchSessionLifecycle, 'active' | 'closed'>
    }) => Promise<WorkbenchSessionSnapshot | null>
    closeSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      projectPath?: string | null
    }) => Promise<{ success: boolean }>
    getSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
    }) => Promise<WorkbenchSessionSnapshot | null>
    listSessions: () => Promise<WorkbenchSessionSnapshot[]>
    setPinned: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      pinned: boolean
    }) => Promise<WorkbenchSessionSnapshot | null>
    getTerminalBinding: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
    }) => Promise<string | null>
    bindTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      terminalId: string
      projectPath?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    releaseTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      close?: boolean
    }) => Promise<{ success: boolean; terminalId?: string }>
    getBrowserBinding: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
    }) => Promise<string | null>
    bindBrowser: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      browserTileId: string
      projectPath?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    releaseBrowser: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      destroy?: boolean
    }) => Promise<{ success: boolean; browserTileId?: string }>
    setNativePreviewSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      locator: import('./nativePreviewTypes').NativePreviewSessionLocator | null
      stopPrevious?: boolean
    }) => Promise<WorkbenchSessionSnapshot | null>
    onStateChanged: (callback: (session: WorkbenchSessionSnapshot) => void) => () => void
  }
  preview: {
    injectBridge: (options: { url: string; frameName?: string }) => Promise<PreviewInjectBridgeResult>
    probePort: (options: { port: number; timeoutMs?: number }) => Promise<PreviewProbePortResult>
    probeUrl: (options: { url: string; timeoutMs?: number }) => Promise<PreviewProbeUrlResult>
    captureScreenshot: (options: { url: string; width?: number; height?: number }) => Promise<PreviewCaptureScreenshotResult>
    captureVisibleRegion: (options: { x: number; y: number; width: number; height: number }) => Promise<PreviewCaptureScreenshotResult>
    inspectSelection: (options: PreviewInspectorSelectionInput) => Promise<PreviewInspectorSelectionResult>
    updateSelectionStyles: (options: PreviewInspectorStyleMutationInput) => Promise<PreviewInspectorMutationResult>
    updateSelectionText: (options: PreviewInspectorTextMutationInput) => Promise<PreviewInspectorMutationResult>
  }
  nativePreview: {
    listIosSimulators: () => Promise<NativePreviewListIosSimulatorsResult>
    resolveLaunchConfig: (options: NativePreviewResolveLaunchConfigRequest) => Promise<NativePreviewResolveLaunchConfigResult>
    startSession: (options: NativePreviewStartSessionRequest) => Promise<NativePreviewStartSessionResult>
    stopSession: (options: NativePreviewStopSessionRequest) => Promise<NativePreviewStopSessionResult>
    getSessionState: (options: NativePreviewSessionLocator) => Promise<NativePreviewSessionState | null>
    sendTouches: (options: NativePreviewSendTouchesRequest) => Promise<NativePreviewActionResult>
    sendWheel: (options: NativePreviewSendWheelRequest) => Promise<NativePreviewActionResult>
    sendKey: (options: NativePreviewSendKeyRequest) => Promise<NativePreviewActionResult>
    sendButton: (options: NativePreviewSendButtonRequest) => Promise<NativePreviewActionResult>
    rotate: (options: NativePreviewRotateRequest) => Promise<NativePreviewActionResult>
    captureScreenshot: (options: NativePreviewCaptureScreenshotRequest) => Promise<NativePreviewCaptureScreenshotResult>
    copyLastScreenshot: (options: NativePreviewCaptureScreenshotRequest) => Promise<NativePreviewActionResult>
    onStateChanged: (callback: (event: NativePreviewStateChangedEvent) => void) => () => void
  }
  project: {
    createFolder: (options: {
      slug: string
      initGit?: boolean
      projectId?: string
      baseDirectory?: string
    }) => Promise<CreateProjectFolderResult>
    cloneRepository: (options: {
      slug: string
      repoUrl: string
      provider: string
      branch?: string
      accessToken?: string
      projectId?: string
      baseDirectory?: string
    }) => Promise<CloneRepositoryResult>
    getLocalPath: (options: string | ProjectLocalPathLookupOptions) => Promise<string | null>
    rememberLocalPath: (options: { projectId: string; projectPath: string }) => Promise<{ success: boolean; localPath?: string; error?: string }>
    clearLocalPath: (options: { projectId: string }) => Promise<{ success: boolean }>
    listGitBranches: (options: { projectPath: string }) => Promise<ProjectGitBranchListResult>
    checkoutGitBranch: (options: { projectPath: string; branch: string }) => Promise<ProjectGitCheckoutResult>
    createGitWorktree: (options: {
      projectPath: string
      branch: string
      newBranch?: string
      path?: string | null
    }) => Promise<ProjectGitCreateWorktreeResult>
    mergeLaneIntoCollab: (options: {
      collabProjectPath: string
      collabBranch: string
      sourceBranch: string
    }) => Promise<{ success: boolean; error?: string }>
    openFolder: (options: { projectPath: string }) => Promise<StorageActionResult>
    exists: (options: string | { slug: string; projectId?: string }) => Promise<boolean>
    pathExists: (projectPath: string) => Promise<boolean>
    writeFile: (options: {
      projectPath: string
      filePath: string
      content: string
      encoding?: 'utf8' | 'base64'
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<WriteFileResult>
    readFile: (options: { projectPath: string; filePath: string }) => Promise<ReadFileResult>
    readFileBase64: (options: { projectPath: string; filePath: string }) => Promise<ReadFileBase64Result>
    listFiles: (options: { projectPath: string }) => Promise<ListFilesResult>
    getContextOptions: (options: {
      projectPath: string
      frameworkInfo?: ProjectStoredFrameworkInfo | null
    }) => Promise<ProjectContextOptionsResult>
    renameFile: (options: {
      projectPath: string
      oldPath: string
      newPath: string
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<RenameFileResult>
    deletePath: (options: {
      projectPath: string
      targetPath: string
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<{ success: boolean; error?: string }>
    copyPath: (options: { projectPath: string; sourcePath: string; destinationPath: string }) => Promise<{ success: boolean; error?: string }>
    copyDirectorySnapshot: (options: { sourcePath: string; targetPath: string; mode?: 'relocation' | 'raw' }) => Promise<CopyDirectorySnapshotResult>
    preflightImportSource: (options: { projectPath: string; mode?: 'relocation' | 'raw' }) => Promise<ImportSourcePreflightResult>
    watchStart: (options: { projectPath: string }) => Promise<WatchProjectResult>
    watchStop: (options: { projectPath: string }) => Promise<WatchProjectResult>
    getPathNativeIcon: (options: { projectPath: string }) => Promise<ProjectPathNativeIconResult>
    checkGhCliStatus: () => Promise<GhCliStatus>
    createGitHubRepo: (options: { name: string; localPath: string; visibility?: 'private' | 'public' }) => Promise<CreateGitHubRepoResult>
  }
  runtime: {
    getProjectCapabilities: (options: { projectPath: string }) => Promise<ProjectRuntimeProfile>
    resolveCommand: (options: { projectPath: string; command: string }) => Promise<RuntimeResolveCommandResult>
    ensureCommandRuntime: (options: { projectPath: string; command: string }) => Promise<RuntimeEnsureResult | { success: false; command: string; error: string }>
    detectProjectRuntime: (options: { projectPath: string }) => Promise<ProjectRuntimeProfile>
    ensureForCommand: (options: { projectPath: string; command: string }) => Promise<RuntimeEnsureResult | { success: false; command: string; error: string }>
    ensureRuntime: (options: {
      runtime: RuntimeKind
      target?: string
      cleanBrokenLocalFiles?: boolean
      forceReinstall?: boolean
    }) => Promise<RuntimeEnsureResult>
    getRuntimeStatus: (options?: { projectPath?: string }) => Promise<{ target: RuntimeTarget; runtimes: RuntimeHealth[] }>
  }
  fs: {
    readDir: (path: string) => Promise<FileEntry[]>
    readFile: (path: string) => Promise<string | null>
  }
  sync: {
    hashFile: (options: { filePath: string }) => Promise<{ hash: string; size: number }>
    writeFiles: (options: {
      projectPath: string
      files: SyncWriteFile[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'editor' | 'agent' | 'watcher' | 'remote'
      }
    }) => Promise<SyncWriteFilesResult>
    deleteFiles: (options: {
      projectPath: string
      paths: string[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'editor' | 'agent' | 'watcher' | 'remote'
      }
    }) => Promise<SyncDeleteFilesResult>
    getGitRuntimeHealth: (options?: { force?: boolean }) => Promise<GitRuntimeHealth>
    gitEnsureRepo: (options: {
      projectPath: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => Promise<GitSyncEnsureRepoResult>
    gitCloneIfMissing: (options: {
      projectPath: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncCloneResult>
    gitFetchMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncFetchResult>
    gitStatus: (options: {
      projectPath: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => Promise<GitSyncStatusResult>
    gitPullMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      strategy?: 'merge' | 'ff-only'
      allowUnrelatedHistories?: boolean
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncPullResult>
    gitReplayLocalCommits: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncReplayResult>
    gitClassifyRepoHealth: (options: {
      projectPath: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => Promise<GitRepoHealthResult>
    gitSalvageReclone: (options: {
      projectPath: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncSalvageResult>
    gitReadConflictFile: (options: {
      projectPath: string
      filePath: string
    }) => Promise<GitConflictFileResult>
    gitResolveConflictFile: (options: {
      projectPath: string
      filePath: string
      resolvedContent: string
    }) => Promise<GitResolveConflictResult>
    gitRestoreMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncRestoreResult>
    gitAdoptWorkspace: (options: {
      projectPath: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => Promise<GitSyncAdoptResult>
    gitCommitAll: (options: {
      projectPath: string
      message: string
      addAll?: boolean
    }) => Promise<GitSyncCommitResult>
    gitPushMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => Promise<GitSyncPushResult>
    gitCommitAndPush: (options: {
      projectPath: string
      message: string
      remote?: string
      branch?: string
      repoUrl?: string
      addAll?: boolean
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => Promise<GitSyncCommitPushResult>
    gitCaptureCheckpoint: (options: {
      projectPath: string
      checkpointId: string
      authorName: string
      authorEmail?: string
    }) => Promise<GitCheckpointCaptureResult>
    gitDiffCheckpoints: (options: {
      projectPath: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath?: string
    }) => Promise<GitCheckpointDiffResult>
    gitReadCheckpointFilePair: (options: {
      projectPath: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath: string
    }) => Promise<GitCheckpointFilePairResult>
    gitDeleteCheckpointRefs: (options: {
      projectPath: string
      checkpointIds: string[]
    }) => Promise<GitCheckpointDeleteResult>
    gitDeleteAllCheckpointRefs: (options: {
      projectPath: string
    }) => Promise<GitCheckpointDeleteResult>
    gitGetHeadDiffStats: (options: {
      projectPath: string
      authorName?: string
    }) => Promise<GitCheckpointHeadStatsResult>
    gitListChanges: (options: {
      projectPath: string
      scope: GitChangesScope
      authorName?: string
    }) => Promise<GitChangesListResult>
    gitReadChangesPatch: (options: {
      projectPath: string
      scope: GitChangesScope
      filePath?: string
      authorName?: string
    }) => Promise<GitChangesPatchResult>
    gitReadChanges: (options: {
      projectPath: string
      scope: GitChangesScope
      authorName?: string
    }) => Promise<GitChangesResult>
    subscribeGitDirtyState: (options: {
      projectPath: string
      authorName?: string
    }) => Promise<GitDirtyStateSnapshot>
    unsubscribeGitDirtyState: (options: {
      projectPath: string
    }) => Promise<{ success: boolean }>
    onGitDirtyStateChange: (callback: (snapshot: GitDirtyStateSnapshot) => void) => () => void
    mergePreview: (options: {
      baseContent: string
      localContent: string
      cloudContent: string
      strategy?: 'zdiff3' | 'diff3'
      labels?: { local?: string; base?: string; cloud?: string }
    }) => Promise<MergePreviewResult>
    mergeTreePreview: (options: {
      baseFiles: Array<{ path: string; content: string }>
      localFiles: Array<{ path: string; content: string }>
      cloudFiles: Array<{ path: string; content: string }>
      maxPreviewFiles?: number
      maxPreviewBytes?: number
    }) => Promise<MergeTreePreviewResult>
    enqueueOps: (options: { projectId: string; ops: SyncOp[] }) =>
      Promise<{ accepted: number; acceptedOpIds: string[]; rejected: number; journalState: SyncJournalState }>
    ackOps: (options: { projectId: string; opIds: string[] }) =>
      Promise<{ acked: number; journalState: SyncJournalState }>
    getJournalState: (options: { projectId: string }) => Promise<SyncJournalState>
  }
  yjs: {
    setInterestRoots: (options: { roots: string[] }) => Promise<{ success: true }>
    onExternalFileChange: (callback: (data: {
      filePath: string
      content: string
      origin?: string | FileChangeAttribution
    }) => void) => () => void
    onExternalFileMetaChange: (callback: (data: {
      filePath: string
      origin?: string | FileChangeAttribution
      isBinary: boolean
      isDirectory?: boolean
      sizeBytes: number
      content?: string
    }) => void) => () => void
    onExternalFileDelete: (callback: (data: {
      filePath: string
      origin?: string | FileChangeAttribution
    }) => void) => () => void
  }
  devServer: {
    start: (options: DevServerStartOptions) => Promise<DevServerStartResult>
    stop: (options: { projectPath: string }) => Promise<{ success: boolean; error?: string }>
    resize: (options: { projectPath: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    isRunning: (options: { projectPath: string }) => Promise<boolean>
    onOutput: (callback: (data: DevServerOutputEvent) => void) => () => void
    onExit: (callback: (data: DevServerExitEvent) => void) => () => void
    onError: (callback: (data: { projectPath: string; error: string }) => void) => () => void
  }
  terminal: {
    create: (options: TerminalCreateOptions) => Promise<{ success: boolean; terminalId?: string; error?: string }>
    attachView: (options: TerminalAttachViewOptions) => Promise<TerminalAttachViewResult>
    detachView: (options: TerminalDetachViewOptions) => Promise<{ success: boolean }>
    input: (options: { terminalId: string; data: string }) => Promise<boolean>
    resize: (options: { terminalId: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    kill: (options: { terminalId: string }) => Promise<{ success: boolean }>
    getProfiles: () => Promise<TerminalProfile[]>
    list: (options: { projectPath: string }) => Promise<string[]>
    getInfo: (options: { terminalId: string }) => Promise<TerminalInfo | null>
    getSnapshot: (options: { terminalId: string }) => Promise<TerminalSnapshot | null>
    getOutputEventsSince: (options: { terminalId: string; afterSequence: number }) => Promise<TerminalOutputEvent[]>
    onOutput: (callback: (data: TerminalOutputEvent) => void) => () => void
    onOutputForTerminal: (terminalId: string, callback: (data: TerminalOutputEvent) => void) => () => void
    onExit: (callback: (data: TerminalExitEvent) => void) => () => void
    onActivity: (callback: (data: TerminalActivityEvent) => void) => () => void
  }
  agentTools: {
    getStatus: (options: { toolId: AgentToolId }) => Promise<AgentToolStatus>
    prepare: (options: { toolId: AgentToolId }) => Promise<AgentToolPrepareResult>
  }
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) => Promise<{ action: string | null }>
    showFileTreeMenu: (options: { targetPath: string; isDirectory: boolean; x: number; y: number }) => Promise<{ action: string | null }>
    showVisualEditorMenu: (options: { hasReactSource: boolean; hasReactStack: boolean; x: number; y: number }) => Promise<{ action: string | null }>
    showNative: (options: {
      x: number
      y: number
      editable?: boolean
      selectionText?: string
      linkUrl?: string
    }) => Promise<{ shown: boolean }>
    showOpenInEditorPicker: (options: {
      x: number
      y: number
      editors: ReadonlyArray<{ id: ExternalEditorId; name: string }>
      selectedEditorId: ExternalEditorId | null
    }) => Promise<{ editorId: ExternalEditorId | null }>
  }
  updates: {
    check: () => Promise<UpdateState>
    download: () => Promise<UpdateState>
    install: () => Promise<{ success: boolean; error?: string }>
    getState: () => Promise<UpdateState>
    onStatus: (callback: (state: UpdateState) => void) => () => void
  }
}
