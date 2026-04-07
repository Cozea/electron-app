import type {
  OrganizationMembership,
  Session,
} from './types'
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
  OrganizationMembership,
  OrganizationWorkspaceMembership,
  PersonalWorkspaceMembership,
  Session,
  User,
  WorkspaceMembership,
} from './types'

export interface AppSettings {
  projectsDirectory: string
  previewHeaderCompatibilityEnabled: boolean
  approvedExternalReadRoots?: string[]
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

export interface StorageUsage {
  projects: number
  dependencies: number
  buildCache: number
  logs: number
  total: number
  diskTotal: number
  diskFree: number
}

export interface LocalProject {
  name: string
  path: string
  size: number
  lastModified: number
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

export type RuntimeSource = 'override' | 'bundled' | 'runtime-pack' | 'system' | 'missing'
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

export interface DiagnosticPublishItem {
  source: 'tsserver' | 'eslint' | 'runtime' | 'build'
  severity: 'error' | 'warning' | 'info'
  message: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  code?: string
  related?: Array<{ message: string; file?: string; line?: number; column?: number }>
}

export interface DiagnosticPublishPayload {
  projectPath: string
  source: 'tsserver' | 'eslint' | 'runtime' | 'build'
  diagnostics: DiagnosticPublishItem[]
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
  source: 'bundled' | 'system' | 'missing'
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

export interface SyncOp {
  opId: string
  idempotencyKey: string
  projectId: string
  actorId: string
  actorType: 'user' | 'agent' | 'system'
  source: 'monaco' | 'agent' | 'watcher' | 'remote'
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

export interface TerminalCreateOptions {
  projectPath: string
  profileId?: string
  cwd?: string
  cols?: number
  rows?: number
  runId?: string
  env?: Record<string, string>
}

export interface TerminalOutputEvent {
  terminalId: string
  data: string
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
  port: number
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

export interface ElectronAPI {
  platform: NodeJS.Platform
  windowContext: ElectronWindowContext
  auth: {
    login: () => Promise<{ success: boolean }>
    logout: (options?: { accessToken?: string | null }) => Promise<{ success: boolean }>
    getSession: () => Promise<Session | null>
    refresh: () => Promise<AuthRefreshResult>
    updateOrganizations: (
      organizations: OrganizationMembership[]
    ) => Promise<{ success: boolean; error?: string }>
    onSuccess: (callback: (session: Session) => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
  localAiRuntime: {
    getStatus: () => Promise<LocalAiRuntimeStatus>
  }
  sourceControl: {
    startOAuth: (options: {
      provider: 'github' | 'gitlab'
      orgId: string
      metadata?: Record<string, unknown>
    }) => Promise<{ success: boolean; error?: string }>
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
      metadata?: Record<string, unknown>
    }) => void) => () => void
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => () => void
    listRepositoryOwners: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      bypassCache?: boolean
    }) => Promise<RepositoryOwnerDescriptor[]>
    listRepositoriesPage: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
      search?: string
      page: number
      pageSize: number
      bypassCache?: boolean
    }) => Promise<RepositoryListPageResult>
    listBranches: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repositoryId?: string
      repositoryFullName: string
      defaultBranch?: string
      bypassCache?: boolean
    }) => Promise<RepositoryBranchDescriptor[]>
    listRepositoryLanguages: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      repositoryId?: string
      bypassCache?: boolean
    }) => Promise<RepositoryLanguageDescriptor[]>
    getRepositoryReadmeSnippet: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      branch?: string
      repositoryId?: string
      bypassCache?: boolean
    }) => Promise<RepositoryReadmeSnippetDescriptor>
    createRepository: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      name: string
      description?: string
      private?: boolean
      autoInit?: boolean
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
    }) => Promise<RepositoryDescriptor>
    invalidateProviderCache: (options?: {
      provider?: 'github' | 'gitlab'
      ownerId?: string
      repositoryId?: string
    }) => Promise<{ success: boolean }>
    syncRepositoryAccess: (options: {
      projectId?: string
      provider: 'github' | 'gitlab'
      repoUrl: string
      providerHost?: string
      accessToken?: string
      action?: 'grant' | 'revoke'
      role?: string
      inviteEmail?: string
      providerAccountHandle?: string
    }) => Promise<{ success: boolean; error?: string; accessState?: 'pending' | 'error' | 'revoked' | 'granted' | 'needs_identity' | 'manual_required'; externalInvitationId?: string; providerAccountHandle?: string }>
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
    getLocalPath: (options: string | { slug: string; projectId?: string }) => Promise<string | null>
    rememberLocalPath: (options: { projectId: string; projectPath: string }) => Promise<{ success: boolean; localPath?: string; error?: string }>
    clearLocalPath: (options: { projectId: string }) => Promise<{ success: boolean }>
    getLaneState: (options: { projectId: string }) => Promise<ProjectLaneState | null>
    ensureCollabLane: (options: { projectId: string; projectPath: string; branch: string }) => Promise<ProjectLaneState>
    upsertLane: (options: {
      projectId: string
      branch: string
      projectPath: string
      name?: string
      isCollab?: boolean
      laneId?: string
    }) => Promise<{ success: boolean; laneState?: ProjectLaneState; error?: string }>
    setActiveLane: (options: { projectId: string; laneId: string }) => Promise<{ success: boolean; laneState?: ProjectLaneState; error?: string }>
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
      origin?: 'agent' | 'remote' | 'sync'
    }) => Promise<WriteFileResult>
    readFile: (options: { projectPath: string; filePath: string }) => Promise<ReadFileResult>
    readFileBase64: (options: { projectPath: string; filePath: string }) => Promise<ReadFileBase64Result>
    listFiles: (options: { projectPath: string }) => Promise<ListFilesResult>
    renameFile: (options: {
      projectPath: string
      oldPath: string
      newPath: string
      origin?: 'agent' | 'remote' | 'sync'
    }) => Promise<RenameFileResult>
    deletePath: (options: {
      projectPath: string
      targetPath: string
      origin?: 'agent' | 'remote' | 'sync'
    }) => Promise<{ success: boolean; error?: string }>
    copyPath: (options: { projectPath: string; sourcePath: string; destinationPath: string }) => Promise<{ success: boolean; error?: string }>
    copyDirectorySnapshot: (options: { sourcePath: string; targetPath: string; mode?: 'relocation' | 'raw' }) => Promise<CopyDirectorySnapshotResult>
    preflightImportSource: (options: { projectPath: string; mode?: 'relocation' | 'raw' }) => Promise<ImportSourcePreflightResult>
    watchStart: (options: { projectPath: string }) => Promise<WatchProjectResult>
    watchStop: (options: { projectPath: string }) => Promise<WatchProjectResult>
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
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
      }
    }) => Promise<SyncWriteFilesResult>
    deleteFiles: (options: {
      projectPath: string
      paths: string[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
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
    onExternalFileChange: (callback: (data: { filePath: string; content: string; origin?: string }) => void) => () => void
    onExternalFileMetaChange: (callback: (data: {
      filePath: string
      origin?: string
      isBinary: boolean
      isDirectory?: boolean
      sizeBytes: number
      content?: string
    }) => void) => () => void
    onExternalFileDelete: (callback: (data: { filePath: string; origin?: string }) => void) => () => void
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
    input: (options: { terminalId: string; data: string }) => Promise<boolean>
    resize: (options: { terminalId: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    kill: (options: { terminalId: string }) => Promise<{ success: boolean }>
    getProfiles: () => Promise<TerminalProfile[]>
    list: (options: { projectPath: string }) => Promise<string[]>
    getInfo: (options: { terminalId: string }) => Promise<TerminalInfo | null>
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
  diagnostics: {
    start: (options: { projectPath: string }) => Promise<{ success: boolean; error?: string }>
    stop: (options: { projectPath: string }) => Promise<{ success: boolean; error?: string }>
    openFile: (options: { projectPath: string; filePath: string; content: string }) => Promise<{ success: boolean; error?: string }>
    updateFile: (options: { projectPath: string; filePath: string; content: string }) => Promise<{ success: boolean; error?: string }>
    closeFile: (options: { projectPath: string; filePath: string }) => Promise<{ success: boolean; error?: string }>
    refresh: (options: { projectPath: string }) => Promise<{ success: boolean; error?: string }>
    getDiagnostics: (options: { projectPath: string; filePath?: string }) => Promise<{
      success: boolean
      error?: string
      diagnostics: Array<{
        id?: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        severity: 'error' | 'warning' | 'info'
        message: string
        file?: string
        line?: number
        column?: number
        endLine?: number
        endColumn?: number
        code?: string
        related?: Array<{ message: string; file?: string; line?: number; column?: number }>
      }>
    }>
    getSnapshot: (options: { projectPath: string; filePaths?: string[] }) => Promise<{
      success: boolean
      error?: string
      diagnostics: Array<{
        id?: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        severity: 'error' | 'warning' | 'info'
        message: string
        file?: string
        line?: number
        column?: number
        endLine?: number
        endColumn?: number
        code?: string
        related?: Array<{ message: string; file?: string; line?: number; column?: number }>
      }>
    }>
    checkFiles: (options: { projectPath: string; filePaths: string[]; timeoutMs?: number }) => Promise<{
      success: boolean
      error?: string
      diagnostics: Array<{
        id?: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        severity: 'error' | 'warning' | 'info'
        message: string
        file?: string
        line?: number
        column?: number
        endLine?: number
        endColumn?: number
        code?: string
        related?: Array<{ message: string; file?: string; line?: number; column?: number }>
      }>
    }>
    onPublish: (callback: (payload: DiagnosticPublishPayload) => void) => () => void
  }
}
