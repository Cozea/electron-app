import type { Session } from './types'
import type {
  AttachExistingFolderRequest,
  AttachExistingFolderResult,
  BindExistingFolderRequest,
  BindExistingFolderResult,
  CloneWorkspaceForProjectRequest,
  CloneWorkspaceForProjectResult,
  CreateWorkspaceForProjectRequest,
  CreateWorkspaceForProjectResult,
  CwdSpec,
  ImportExistingFolderRequest,
  ImportExistingFolderResult,
  LocalWorkspaceDTO,
  LocalWorkspaceRecord,
  PreflightExistingFolderRequest,
  PreflightExistingFolderResult,
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
  WorkspaceCandidate,
  WorkspaceCatalogSnapshot,
  TrashManagedWorkspaceResult,
} from './workspaceTypes'
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

export type { PersonalWorkspaceMembership, Session, User, WorkspaceMembership } from './types'

export interface AppSettings {
  projectsDirectory: string
  previewHeaderCompatibilityEnabled: boolean
  approvedExternalReadRoots?: string[]
  deactivateTransparency?: boolean
  /**
   * Last theme source the renderer synced via app:setNativeThemeSource.
   * Restored before window creation so native UI (window background,
   * titlebar overlay, menus) matches the app theme from the first frame
   * of a cold start instead of following the OS until React mounts.
   */
  nativeThemeSource?: 'system' | 'light' | 'dark'
  computerUseEnabled?: boolean
  computerUseCliPath?: string
  disabledComputerUseTools?: string[]
}

export interface ComputerUseDiagnostics {
  installed: boolean
  version?: string
  path?: string
  accessibility: boolean
  screenRecording: boolean
  error?: string
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'

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

export type RuntimeKind = 'node' | 'npm' | 'corepack' | 'pnpm' | 'yarn' | 'bun' | 'python' | 'rust' | 'go'

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

export interface GhCliStatus {
  available: boolean
  username?: string
  error?: string
}

export interface CreateGitHubRepoResult {
  success: boolean
  repoUrl?: string
  defaultBranch?: string
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
  workspaceId: string
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

export interface ProjectDirectoryEntry {
  name: string
  type: 'file' | 'directory'
}

export interface ListProjectDirectoryResult {
  success: boolean
  entries?: ProjectDirectoryEntry[]
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
  | 'http_error_response'
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
  refused?: boolean
  refusalReason?: string
  suggestedPublishBranch?: string
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
  /** Set when capture was a clean no-op (e.g. workspace has no git root). */
  skipped?: 'no-git-root'
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
  workspaceId: string
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
  workspaceId: string
  additions: number
  deletions: number
  changedFiles: number
  computedAt: number
  error?: string
}

export interface GitChangesSnapshot {
  workspaceId: string
  scope: GitChangesScope
  cacheKey: string
  files: GitChangeFileSummary[]
  patch: string
  loaded: boolean
  error: string | null
  baseRef?: string
  headRef?: string
  additions: number
  deletions: number
}

export interface TerminalCreateOptions {
  workspaceId: string
  profileId?: string
  cwd?: CwdSpec
  cols?: number
  rows?: number
  runId?: string
  env?: Record<string, string>
  activityTracking?: TerminalActivityTrackingMode
  sessionKey?: string
  laneId?: string

  gitCwd?: CwdSpec
  terminalKind?: TerminalKind
}

export interface TerminalCreateResult {
  success: boolean
  terminalId?: string
  error?: string
  snapshot?: TerminalSnapshot | null
  info?: TerminalInfo | null
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

export type AgentToolId = 'claude' | 'gemini' | 'kilo' | 'shell' | 'copilot' | 'codex' | 'cursor' | 'opencode'

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

export interface AgentToolLoginStartResult {
  sessionId: string | null
  error?: string
}

export interface AgentToolLoginEvent {
  sessionId: string
  toolId: AgentToolId
  type: 'auth-url' | 'awaiting-code' | 'output' | 'closed'
  /** auth-url: the URL opened in the browser; awaiting-code: the prompt line;
   * output: latest output tail; closed: final output tail. */
  data?: string
  /** Only on 'closed'. */
  success?: boolean
  error?: string
}

export type AgentSkillProvider = 'codex' | 'claude' | 'cursor' | 'opencode'

/**
 * `catalog` is a skill sitting in a provider's plugin marketplace: present on
 * disk, but not loaded by the provider until it is installed.
 */
export type AgentSkillSource = 'managed' | 'external' | 'catalog'

export type AgentSkillRestartBehavior = 'live' | 'restart-external-app' | 'restart-recommended'

/**
 * Where an update pulls its newer copy from. Cozea never checks for updates on
 * its own, so this only says whether the manual Update button has somewhere to
 * read from — not that anything newer exists.
 */
export type AgentSkillUpdateSource = 'built-in' | 'folder' | 'providers' | 'none'

export interface AgentSkillProviderInfo {
  id: AgentSkillProvider
  label: string
  /** Where Cozea installs a skill it manages. Always the first of `rootPaths`. */
  rootPath: string
  /** Every folder this provider loads skills from, including read-only ones. */
  rootPaths: string[]
  restartBehavior: AgentSkillRestartBehavior
}

export interface AgentSkillProviderBinding {
  provider: AgentSkillProvider
  compatible: boolean
  enabled: boolean
  ownership: AgentSkillSource | 'none'
  path: string | null
  restartBehavior: AgentSkillRestartBehavior
  /** The skill is in this provider's catalog and can be installed for it. */
  available?: boolean
  /**
   * The provider owns this copy and rewrites the folder it lives in, so Cozea
   * cannot switch it off — it moves the files out and the provider restores
   * them. Reported as essential instead of offered as a toggle.
   */
  essential?: boolean
  /**
   * This provider's own copy of the skill, present only when it differs from
   * the record's canonical text — the usual reason being a copy tailored to
   * that provider's paths or frontmatter. Absent means it matches.
   */
  variant?: { description: string; instructions: string }
}

export interface AgentSkillRecord {
  id: string
  slug: string
  name: string
  description: string
  instructions: string
  source: AgentSkillSource
  editable: boolean
  path: string
  createdAt: number | null
  updatedAt: number
  originLabel?: string
  /** Shelf the page groups this skill under; see shared/agentSkillCategories. */
  category: string
  /** True when the author declared `category:` instead of Cozea inferring one. */
  categoryDeclared: boolean
  updateSource: AgentSkillUpdateSource
  /** Folder the update re-reads, when `updateSource` is `folder`. */
  originPath?: string
  bindings: AgentSkillProviderBinding[]
}

/**
 * A named set of skills to run with — a loadout. Applying one turns its skills
 * on and everything else off, so switching between "writing docs" and "fixing
 * CI" is one click rather than a dozen toggles.
 */
export interface AgentSkillBuild {
  id: string
  name: string
  /** Skills this build turns on. Ids that no longer resolve are ignored. */
  skillIds: string[]
  createdAt: number
  updatedAt: number
}

export interface AgentSkillsSnapshot {
  skills: AgentSkillRecord[]
  providers: AgentSkillProviderInfo[]
  libraryPath: string
  generatedAt: number
  builds: AgentSkillBuild[]
  /** The build whose skills exactly match what is enabled, if any. */
  activeBuildId: string | null
}

export interface AgentSkillMutationResult {
  success: boolean
  snapshot: AgentSkillsSnapshot
  skillId?: string
  changedProviders?: AgentSkillProvider[]
  error?: string
}

export interface AgentSkillDraft {
  skillId?: string
  name: string
  description: string
  instructions: string
  compatibleProviders: AgentSkillProvider[]
  category?: string
}

export interface AgentSkillSetupPackSkill {
  packSkillId: string
  name: string
  slug: string
  description: string
  instructions: string
  compatibleProviders: AgentSkillProvider[]
  enabledProviders: AgentSkillProvider[]
}

export interface AgentSkillSetupPack {
  version: 1
  setupName: string
  authorName: string
  exportedAt: number
  sourcePath: string
  skills: AgentSkillSetupPackSkill[]
}

export interface AgentSkillSetupPackResult {
  success: boolean
  pack?: AgentSkillSetupPack
  error?: string
}

export interface AgentSkillExportResult {
  success: boolean
  filePath?: string
  error?: string
}

export type ProjectMemoryNodeState = 'new' | 'changed' | 'unchanged'

/** One remembered thing in the project graph an agent built. */
export interface ProjectMemoryNode {
  id: string
  label: string
  community: number | null
  communityName: string | null
  fileType: string | null
  sourceFile: string | null
  sourceLocation: string | null
  state: ProjectMemoryNodeState
  degree: number
}

export interface ProjectMemoryLink {
  source: string
  target: string
  relation: string
  weight: number
  state: ProjectMemoryNodeState
}

export interface ProjectMemoryCommunity {
  id: number
  name: string
  nodeCount: number
}

export interface ProjectMemoryGraph {
  workspaceId: string
  builtAtCommit: string | null
  generatedAt: number
  nodes: ProjectMemoryNode[]
  links: ProjectMemoryLink[]
  communities: ProjectMemoryCommunity[]
  counts: {
    total: number
    new: number
    changed: number
    unchanged: number
    /** Nodes whose file_type is not code: docs, decks, notes. */
    nonCode: number
  }
}

/** Absence of a graph is a setup state, not a failure: agents build it, not Cozea. */
export interface ProjectMemoryStatus {
  available: boolean
  graphifyInstalled: boolean
  /** False when the project has no source yet, which is not the same as no map. */
  projectHasSource: boolean
  graphPath: string | null
  builtAtCommit: string | null
  generatedAt: number | null
  nodeCount: number
  linkCount: number
  error?: string
}

export interface ProjectMemoryNodeChange {
  field: string
  before: string | null
  after: string | null
}

export interface ProjectMemoryNodeDetail {
  node: ProjectMemoryNode
  neighbors: Array<{ id: string; label: string; relation: string; direction: 'in' | 'out' }>
  changes: ProjectMemoryNodeChange[]
}

export interface DevServerAuxiliaryProcessConfig {
  id: string
  name: string
  command: string
}

export interface DevServerManagedProcessState {
  id: string
  name: string
  terminalId: string
  kind: 'primary' | 'auxiliary'
  running: boolean
}

export interface DevServerStartOptions {
  workspaceId: string
  laneId?: string | null
  command: string
  bootstrapCommand?: string | null
  auxiliaryProcesses?: DevServerAuxiliaryProcessConfig[]
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
  workspaceId: string
  laneId?: string | null
  output: string
  stream: 'stdout' | 'stderr'
  runId?: string
}

export interface DevServerExitEvent {
  workspaceId: string
  laneId?: string | null
  code: number | null
  runId?: string
}

/** Main-process truth about one workspace::lane dev server run. */
export interface DevServerProcessState {
  running: boolean
  ready: boolean
  port: number | null
  runId: string | null
  phase: 'bootstrapping' | 'launching' | 'running' | null
  headless: boolean
  /** Owning PTY for restoring logs when a headless surface is reopened. */
  terminalId: string | null
  /** The primary frontend plus any project-local user-configured processes. */
  processes: DevServerManagedProcessState[]
}

/** Authoritative main-process state pushed after a run lifecycle change. */
export interface DevServerProcessStateEvent extends DevServerProcessState {
  workspaceId: string
  laneId?: string | null
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
  userId: string
  identityKey: string
  deviceLabel: string
  platform: string
  publicKeyAlgorithm: string
  fingerprint: string
  publicKeyJwk: string
  signingPublicKeyAlgorithm?: string
  signingFingerprint?: string
  signingPublicKeyJwk?: string
}

export interface CollabDeviceChallengeSignature {
  deviceId: string
  userId: string
  identityKey: string
  algorithm: string
  signature: string
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

export type ExternalBrowserId = 'system' | 'safari' | 'chrome' | 'arc' | 'firefox' | 'edge' | 'brave'

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
  | 'finder'
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

export type WorkbenchSessionLifecycle = 'active' | 'backgroundWarm' | 'backgroundFrozen' | 'closed'

export interface WorkbenchSessionDevServerState {
  running: boolean
  port: number | null
  runId: string | null
}

export interface WorkbenchSessionSnapshot {
  sessionKey: string
  projectId: string
  laneId: string
  workspaceId: string | null
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
  /**
   * Resolve an absolute filesystem path for a Web File from drag-and-drop
   * or `<input type="file">`. Must be called with File objects from the DOM.
   */
  getPathForFile: (file: File) => string
  /** Declared ahead of the managed local chat runtime; preload does not expose it yet. */
  localAiRuntime?: {
    getStatus: () => Promise<LocalAiRuntimeStatus>
  }
  computerUse?: {
    getDiagnostics: () => Promise<ComputerUseDiagnostics>
    openPermissionSettings: (target: 'accessibility' | 'screenRecording') => Promise<void>
  }
  integrations: {
    isEncryptionAvailable: () => Promise<boolean>
    generateKey: () => Promise<IntegrationKeyResult>
    storeKey: (options: { keyId: string; keyData: string }) => Promise<{ success: boolean; error?: string }>
    deleteKey: (options: { keyId: string }) => Promise<{ success: boolean; error?: string }>
    keyExists: (options: { keyId: string }) => Promise<boolean>
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) => Promise<IntegrationEncryptResult>
    onOAuthSuccess: (
      callback: (data: {
        provider: string
        accessToken?: string
        refreshToken?: string
        tokenExpiresAt?: number
        externalId?: string
        externalAccountName?: string
        scopes?: string[]
      }) => void,
    ) => () => void
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => () => void
    startOAuth: (options: {
      provider: string
      orgId: string
      metadata?: Record<string, unknown>
    }) => Promise<{ success: boolean; error?: string }>
    runTool: (options: {
      toolName: string
      args: string[]
      workspaceId: string
      laneId: string
      cwd?: { kind: 'projectRoot' } | { kind: 'relative'; path: string }
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
    signDeviceChallenge: (challenge: string) => Promise<CollabDeviceChallengeSignature>
    wrapRoomKey: (options: {
      roomKeyBase64: string
      recipientPublicKeyJwk: string
    }) => Promise<CollabWrappedRoomKeyResult>
    unwrapRoomKey: (options: {
      senderPublicKeyJwk: string
      wrappedKey: string
      wrapAlgorithm?: string
    }) => Promise<{ roomKeyBase64: string }>
    createRecoveryKit: (options: { roomKeyBase64: string; recoveryCode?: string }) => Promise<CollabRecoveryKitResult>
    unwrapRecoveryKit: (options: {
      recoveryCode: string
      wrappedKey: string
      salt: string
      iterations: number
      wrapAlgorithm?: string
    }) => Promise<{ roomKeyBase64: string }>
    deleteDeviceIdentity: () => Promise<{ success: boolean; error?: string }>
  }
  shell: {
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    listAvailableBrowsers: () => Promise<AvailableExternalBrowserResult>
    openInBrowser: (options: {
      url: string
      browserId?: ExternalBrowserId
    }) => Promise<{ success: boolean; error?: string }>
  }
  editor: {
    listAvailableEditors: () => Promise<AvailableExternalEditor[]>
    openInEditor: (options: {
      editorId?: string
      workspaceId?: string
      filePath?: string
      path?: string
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
    clearAll: () => Promise<StorageActionResult>
  }
  window: {
    isFullScreen: () => Promise<boolean>
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void
    openSettings: (route?: string) => Promise<{ success: boolean; error?: string }>
  }
  orgDevApp: {
    listInstallations: () => Promise<
      | { success: true; installations: import('./orgDevAppInstallation').OrgDevAppInstallation[] }
      | { success: false; error: string }
    >
    getInstallation: (options: { ref: string }) => Promise<
      | {
          success: true
          installation: import('./orgDevAppInstallation').OrgDevAppInstallation | null
        }
      | { success: false; error: string }
    >
    install: (
      request: import('./orgDevAppInstallation').OrgDevAppInstallRequest,
    ) => Promise<
      | { success: true; installation: import('./orgDevAppInstallation').OrgDevAppInstallation }
      | { success: false; error: string }
    >
    prepareInstalled: (options: {
      ref: string
    }) => Promise<
      | { success: true; artifact: import('./orgDevAppInstallation').OrgDevAppInstalledArtifact }
      | { success: false; error: string }
    >
    uninstallPublication: (options: {
      publicationId: string
    }) => Promise<{ success: true; removed: number } | { success: false; error: string }>
    removeInstalledVersion: (options: {
      ref: string
    }) => Promise<{ success: true; removed: boolean } | { success: false; error: string }>
    onInstallationsChanged: (
      listener: (installations: import('./orgDevAppInstallation').OrgDevAppInstallation[]) => void,
    ) => () => void
    buildAndUpload: (options: {
      workspaceId: string
      laneId?: string | null
      operationId?: string
      uploadUrl: string
    }) => Promise<
      | {
          success: true
          storageId: string
          contentHash: string
          entryPath: string
          framework: string
          runtimeKind: 'static' | 'service'
          manifestVersion?: number
          platform?: string
          arch?: string
          permissionSetHash?: string
        }
      | { success: false; error: string }
    >
    startRuntimeBuild: (options: {
      workspaceId: string
      laneId?: string | null
      projectId: string
      uploadReservationId: string
      accessToken: string
    }) => Promise<
      | { success: true; build: import('./devAppContainedRuntime').DevAppRuntimeBuildDescriptor }
      | { success: false; error: string }
    >
    getRuntimeBuild: (options: {
      buildId: string
      accessToken: string
    }) => Promise<
      | { success: true; build: import('./devAppContainedRuntime').DevAppRuntimeBuildDescriptor }
      | { success: false; error: string }
    >
    getPublishedWorkerApproval: (options: { ref: string; workspaceId: string }) => Promise<
      | {
          success: true
          requestedCapabilities: import('./devAppCapabilities').DevAppCapability[]
          approved: boolean
          agentInvocable: boolean
          expiresAt: number | null
        }
      | { success: false; error: string }
    >
    approvePublishedWorker: (options: {
      ref: string
      workspaceId: string
      agentInvocable: boolean
    }) => Promise<{ success: true; expiresAt: number } | { success: false; error: string }>
    revokePublishedWorker: (options: {
      ref: string
      workspaceId: string
    }) => Promise<{ success: true } | { success: false; error: string }>
    listFolderGrants: (options: {
      ref: string
    }) => Promise<
      | { success: true; grants: import('./devAppContainedRuntime').DevAppFolderGrant[] }
      | { success: false; error: string }
    >
    grantFolder: (options: {
      ref: string
      access: import('./devAppContainedRuntime').DevAppFolderGrantAccess
    }) => Promise<
      | { success: true; grant: import('./devAppContainedRuntime').DevAppFolderGrant | null }
      | { success: false; error: string }
    >
    revokeFolderGrant: (options: {
      ref: string
      grantId: string
    }) => Promise<{ success: true; revoked: boolean } | { success: false; error: string }>
    stopPublishedRuntime: (options: {
      ref: string
      workspaceId: string
    }) => Promise<{ success: true; stopped: boolean } | { success: false; error: string }>
    releasePublishedRuntime: (options: {
      ref: string
      workspaceId: string
      leaseId: string
    }) => Promise<{ success: true; released: boolean } | { success: false; error: string }>
    getPublishedToolStatus: (options: { ref: string; workspaceId: string; laneId?: string | null }) => Promise<
      | {
          success: true
          status: {
            ref: string
            name: string
            declaredTools: import('./devAppPackage').DevAppPackageToolSpec[]
            agentInvocable: boolean
            toolInvocationAvailable: boolean
            worker: null | {
              status: 'starting' | 'ready' | 'stopped' | 'crashed'
              restarts: number
              lastError: string | null
            }
          }
        }
      | { success: false; error: string }
    >
    invokePublishedTool: (options: {
      ref: string
      workspaceId: string
      laneId?: string | null
      name: string
      input: unknown
      timeoutMs?: number
    }) => Promise<{ success: true; result: unknown } | { success: false; error: string }>
    ensurePublishedRuntime: (options: {
      ref: string
      workspaceId: string
      laneId?: string | null
      leaseId: string
      accessToken: string
    }) => Promise<
      | {
          success: true
          runtimeId: string
          workerStatus: 'none' | 'starting' | 'approvalRequired'
          requestedCapabilities?: import('./devAppCapabilities').DevAppCapability[]
        }
      | { success: false; error: string }
    >
    cancelBuild: (options: { operationId: string }) => Promise<{ cancelled: boolean }>
    prepareArtifact: (options: {
      downloadUrl: string
      contentHash: string
      entryPath?: string
      runtimeKind?: 'static' | 'service'
    }) => Promise<
      | {
          success: true
          originUrl: string
          contentHash: string
          entryPath: string
          runtimeKind: 'static' | 'service'
          servicePermissions?: { network: boolean; persistentData: boolean }
        }
      | { success: false; error: string }
    >
    getRuntimeTrust: (options: {
      contentHash: string
      publicationId: string
      permissionSetHash: string
    }) => Promise<{ success: true; trusted: boolean } | { success: false; error: string }>
    approveRuntime: (options: {
      contentHash: string
      publicationId: string
      permissionSetHash: string
    }) => Promise<{ success: true } | { success: false; error: string }>
    getRuntimeEnvironment: (options: {
      contentHash: string
      publicationId: string
    }) => Promise<
      | { success: true; status: import('./orgDevAppEnvironment').OrgDevAppEnvironmentStatus }
      | { success: false; error: string }
    >
    setRuntimeEnvironment: (options: {
      contentHash: string
      publicationId: string
      values: Record<string, string | null>
    }) => Promise<
      | { success: true; status: import('./orgDevAppEnvironment').OrgDevAppEnvironmentStatus }
      | { success: false; error: string }
    >
    startRuntime: (options: {
      ref: string
      contentHash: string
      publicationId: string
      permissionSetHash: string
      leaseId: string
      workspaceId: string
      laneId?: string | null
      accessToken: string
    }) => Promise<
      { success: true; state: import('./orgDevAppRuntime').OrgDevAppRuntimeState } | { success: false; error: string }
    >
    releaseRuntime: (options: {
      contentHash: string
      publicationId: string
      leaseId: string
    }) => Promise<{ released: boolean }>
    stopRuntime: (options: {
      contentHash: string
      publicationId: string
    }) => Promise<
      { success: true; state: import('./orgDevAppRuntime').OrgDevAppRuntimeState } | { success: false; error: string }
    >
    getRuntimeState: (options: {
      contentHash: string
      publicationId: string
    }) => Promise<
      { success: true; state: import('./orgDevAppRuntime').OrgDevAppRuntimeState } | { success: false; error: string }
    >
  }
  devAppPreview: {
    /**
     * Opens an unpublished package for preview.
     *
     * `relativePath` is relative to the workspace root. The renderer cannot name a
     * directory: main joins it against the root that authorization returns.
     */
    open: (options: {
      workspaceId: string
      laneId?: string | null
      relativePath: string
      leaseId: string
    }) => Promise<import('./devAppPreviewTypes').DevAppPreviewOpenResult>
    approve: (options: {
      sourceId: string
      approvalFingerprint: string
    }) => Promise<import('./devAppPreviewTypes').DevAppPreviewResult>
    status: (options: { sourceId: string }) => Promise<import('./devAppPreviewTypes').DevAppPreviewResult>
    invokeTool: (options: {
      sourceId: string
      name: string
      input: unknown
      timeoutMs?: number
    }) => Promise<{ success: true; result: unknown } | { success: false; error: string }>
    close: (options: { sourceId: string; leaseId: string }) => Promise<{ success: true }>
    onStatus: (
      listener: (payload: { sourceId: string; status: import('./devAppPreviewTypes').DevAppPreviewStatus }) => void,
    ) => () => void
  }
  devAppAuthoring: {
    inspectWorkspace: (options: {
      workspaceId: string
      relativePath?: string
    }) => Promise<import('./devAppAuthoringTypes').DevAppAuthoringInspectionResult>
    inspectFolder: (options: {
      folderPath: string
    }) => Promise<import('./devAppAuthoringTypes').DevAppAuthoringInspectionResult>
    listDevelopmentSources: () => Promise<import('./devAppAuthoringTypes').DevAppAuthoringListResult>
    scaffold: (options: {
      workspaceId: string
      name: string
      starter: import('./devAppAuthoringTypes').DevAppScaffoldStarter
    }) => Promise<import('./devAppAuthoringTypes').DevAppAuthoringScaffoldResult>
  }
  workbenchSession: {
    ensureSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      workspaceId?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    activateSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      workspaceId?: string | null
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
      workspaceId?: string | null
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
      workspaceId?: string | null
    }) => Promise<WorkbenchSessionSnapshot>
    releaseTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      close?: boolean
    }) => Promise<{ success: boolean; terminalId?: string }>
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
    captureScreenshot: (options: {
      url: string
      width?: number
      height?: number
    }) => Promise<PreviewCaptureScreenshotResult>
    captureVisibleRegion: (options: {
      x: number
      y: number
      width: number
      height: number
    }) => Promise<PreviewCaptureScreenshotResult>
    inspectSelection: (options: PreviewInspectorSelectionInput) => Promise<PreviewInspectorSelectionResult>
    updateSelectionStyles: (options: PreviewInspectorStyleMutationInput) => Promise<PreviewInspectorMutationResult>
    updateSelectionText: (options: PreviewInspectorTextMutationInput) => Promise<PreviewInspectorMutationResult>
  }
  nativePreview: {
    listIosSimulators: () => Promise<NativePreviewListIosSimulatorsResult>
    resolveLaunchConfig: (
      options: NativePreviewResolveLaunchConfigRequest,
    ) => Promise<NativePreviewResolveLaunchConfigResult>
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
    listGitBranches: (options: { workspaceId: string }) => Promise<ProjectGitBranchListResult>
    checkoutGitBranch: (options: { workspaceId: string; branch: string }) => Promise<ProjectGitCheckoutResult>
    createGitWorktree: (options: {
      workspaceId: string
      branch: string
      newBranch?: string
      path?: string | null
    }) => Promise<ProjectGitCreateWorktreeResult>
    mergeLaneIntoCollab: (options: {
      collabProjectPath: string
      collabBranch: string
      sourceBranch: string
    }) => Promise<{ success: boolean; error?: string }>
    openFolder: (options: { workspaceId: string }) => Promise<StorageActionResult>
    pathExists: (workspaceId: string) => Promise<boolean>
    /** Resolves an opaque workspace id to its absolute project root path (or null if unauthorized/unknown). */
    resolveRoot: (workspaceId: string) => Promise<string | null>
    writeFile: (options: {
      workspaceId: string
      filePath: string
      content: string
      encoding?: 'utf8' | 'base64'
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<WriteFileResult>
    readFile: (options: { workspaceId: string; filePath: string }) => Promise<ReadFileResult>
    readFileBase64: (options: { workspaceId: string; filePath: string }) => Promise<ReadFileBase64Result>
    listDirectory: (options: { workspaceId: string; directory?: string | null }) => Promise<ListProjectDirectoryResult>
    listFiles: (options: { workspaceId: string }) => Promise<ListFilesResult>
    getContextOptions: (options: {
      workspaceId: string
      frameworkInfo?: ProjectStoredFrameworkInfo | null
    }) => Promise<ProjectContextOptionsResult>
    renameFile: (options: {
      workspaceId: string
      oldPath: string
      newPath: string
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<RenameFileResult>
    deletePath: (options: {
      workspaceId: string
      targetPath: string
      origin?: 'agent' | 'remote' | 'sync' | FileChangeAttribution
    }) => Promise<{ success: boolean; error?: string }>
    copyPath: (options: {
      workspaceId: string
      sourcePath: string
      destinationPath: string
    }) => Promise<{ success: boolean; error?: string }>
    copyDirectorySnapshot: (options: {
      sourcePath: string
      targetPath: string
      mode?: 'relocation' | 'raw'
    }) => Promise<CopyDirectorySnapshotResult>
    preflightImportSource: (options: {
      workspaceId: string
      mode?: 'relocation' | 'raw'
    }) => Promise<ImportSourcePreflightResult>
    watchStart: (options: { workspaceId: string }) => Promise<WatchProjectResult>
    watchStop: (options: { workspaceId: string }) => Promise<WatchProjectResult>
    getPathNativeIcon: (options: { workspaceId: string }) => Promise<ProjectPathNativeIconResult>
    checkGhCliStatus: () => Promise<GhCliStatus>
    createGitHubRepo: (options: {
      workspaceId: string
      name: string
      visibility?: 'private' | 'public'
    }) => Promise<CreateGitHubRepoResult>
  }
  runtime: {
    getProjectCapabilities: (options: { workspaceId: string }) => Promise<ProjectRuntimeProfile>
    resolveCommand: (options: { workspaceId: string; command: string }) => Promise<RuntimeResolveCommandResult>
    ensureCommandRuntime: (options: {
      workspaceId: string
      command: string
    }) => Promise<RuntimeEnsureResult | { success: false; command: string; error: string }>
    detectProjectRuntime: (options: { workspaceId: string }) => Promise<ProjectRuntimeProfile>
    ensureForCommand: (options: {
      workspaceId: string
      command: string
    }) => Promise<RuntimeEnsureResult | { success: false; command: string; error: string }>
    ensureRuntime: (options: {
      runtime: RuntimeKind
      target?: string
      cleanBrokenLocalFiles?: boolean
      forceReinstall?: boolean
    }) => Promise<RuntimeEnsureResult>
    getRuntimeStatus: (options?: {
      workspaceId?: string
    }) => Promise<{ target: RuntimeTarget; runtimes: RuntimeHealth[] }>
  }
  /**
   * System-level, read-only file APIs that rely on `approvedExternalReadRoots`.
   * These MUST NOT be used for reading project files inside a workspace.
   * For workspace files, use `project.readFile` or `project.listFiles` with a `workspaceId`.
   */
  fs: {
    readDir: (path: string) => Promise<FileEntry[]>
    readFile: (path: string) => Promise<string | null>
  }
  workspaceSync: {
    hashFile: (options: {
      workspaceId: string
      laneId?: string | null
      path: string
    }) => Promise<{ hash: string; size: number } | { success: false; error: string }>
    writeFiles: (options: {
      workspaceId: string
      files: SyncWriteFile[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'editor' | 'agent' | 'watcher' | 'remote'
      }
    }) => Promise<SyncWriteFilesResult>
    deleteFiles: (options: {
      workspaceId: string
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
      workspaceId: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => Promise<GitSyncEnsureRepoResult>
    gitCloneIfMissing: (options: {
      workspaceId: string
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
      workspaceId: string
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
      workspaceId: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => Promise<GitSyncStatusResult>
    gitPullMain: (options: {
      workspaceId: string
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
      workspaceId: string
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
      workspaceId: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => Promise<GitRepoHealthResult>
    gitSalvageReclone: (options: {
      workspaceId: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncSalvageResult>
    gitReadConflictFile: (options: { workspaceId: string; filePath: string }) => Promise<GitConflictFileResult>
    gitResolveConflictFile: (options: {
      workspaceId: string
      filePath: string
      resolvedContent: string
    }) => Promise<GitResolveConflictResult>
    gitRestoreMain: (options: {
      workspaceId: string
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
      workspaceId: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => Promise<GitSyncAdoptResult>
    gitCommitAll: (options: { workspaceId: string; message: string; addAll?: boolean }) => Promise<GitSyncCommitResult>
    gitPushMain: (options: {
      workspaceId: string
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
      workspaceId: string
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
      workspaceId: string
      checkpointId: string
      authorName: string
      authorEmail?: string
    }) => Promise<GitCheckpointCaptureResult>
    gitDiffCheckpoints: (options: {
      workspaceId: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath?: string
    }) => Promise<GitCheckpointDiffResult>
    gitReadCheckpointFilePair: (options: {
      workspaceId: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath: string
    }) => Promise<GitCheckpointFilePairResult>
    gitDeleteCheckpointRefs: (options: {
      workspaceId: string
      checkpointIds: string[]
    }) => Promise<GitCheckpointDeleteResult>
    gitDeleteAllCheckpointRefs: (options: { workspaceId: string }) => Promise<GitCheckpointDeleteResult>
    gitGetHeadDiffStats: (options: {
      workspaceId: string
      authorName?: string
    }) => Promise<GitCheckpointHeadStatsResult>
    gitListChanges: (options: {
      workspaceId: string
      scope: GitChangesScope
      authorName?: string
    }) => Promise<GitChangesListResult>
    gitReadChangesPatch: (options: {
      workspaceId: string
      scope: GitChangesScope
      filePath?: string
      authorName?: string
    }) => Promise<GitChangesPatchResult>
    gitReadChanges: (options: {
      workspaceId: string
      scope: GitChangesScope
      authorName?: string
    }) => Promise<GitChangesResult>
    subscribeGitChanges: (options: { workspaceId: string; scope: GitChangesScope }) => Promise<GitChangesSnapshot>
    unsubscribeGitChanges: (options: { workspaceId: string; scope: GitChangesScope }) => Promise<{ success: boolean }>
    onGitChangesUpdated: (callback: (snapshot: GitChangesSnapshot) => void) => () => void
    subscribeGitDirtyState: (options: { workspaceId: string; authorName?: string }) => Promise<GitDirtyStateSnapshot>
    unsubscribeGitDirtyState: (options: { workspaceId: string }) => Promise<{ success: boolean }>
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
    enqueueOps: (options: { projectId: string; ops: SyncOp[] }) => Promise<{
      accepted: number
      acceptedOpIds: string[]
      rejected: number
      journalState: SyncJournalState
    }>
    ackOps: (options: {
      projectId: string
      opIds: string[]
    }) => Promise<{ acked: number; journalState: SyncJournalState }>
    getJournalState: (options: { projectId: string }) => Promise<SyncJournalState>
  }
  yjs: {
    setInterestRoots: (options: { roots: string[] }) => Promise<{ success: true }>
    onExternalFileChange: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        content: string
        origin?: string | FileChangeAttribution
      }) => void,
    ) => () => void
    onExternalFileMetaChange: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        origin?: string | FileChangeAttribution
        isBinary: boolean
        isDirectory?: boolean
        sizeBytes: number
        content?: string
      }) => void,
    ) => () => void
    onExternalFileDelete: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        origin?: string | FileChangeAttribution
      }) => void,
    ) => () => void
  }
  devServer: {
    start: (options: DevServerStartOptions) => Promise<DevServerStartResult>
    ensure: (options: DevServerStartOptions) => Promise<DevServerStartResult>
    detachSurface: (options: {
      workspaceId: string
      laneId?: string | null
      terminalId: string
    }) => Promise<{ success: boolean; ownsRuntime: boolean; error?: string }>
    attachSurface: (options: {
      workspaceId: string
      laneId?: string | null
      terminalId: string
    }) => Promise<{ success: boolean; ownsRuntime: boolean; error?: string }>
    stop: (options: { workspaceId: string; laneId?: string | null }) => Promise<{ success: boolean; error?: string }>
    resize: (options: {
      workspaceId: string
      laneId?: string | null
      cols: number
      rows: number
    }) => Promise<{ success: boolean }>
    isRunning: (options: { workspaceId: string; laneId?: string | null }) => Promise<boolean>
    getState: (options: { workspaceId: string; laneId?: string | null }) => Promise<DevServerProcessState>
    onStateChange: (callback: (data: DevServerProcessStateEvent) => void) => () => void
    onOutput: (callback: (data: DevServerOutputEvent) => void) => () => void
    onExit: (callback: (data: DevServerExitEvent) => void) => () => void
  }
  terminal: {
    create: (options: TerminalCreateOptions) => Promise<TerminalCreateResult>
    attachView: (options: TerminalAttachViewOptions) => Promise<TerminalAttachViewResult>
    detachView: (options: TerminalDetachViewOptions) => Promise<{ success: boolean }>
    input: (options: { terminalId: string; data: string }) => Promise<boolean>
    resize: (options: { terminalId: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    kill: (options: { terminalId: string }) => Promise<{ success: boolean }>
    getProfiles: () => Promise<TerminalProfile[]>
    list: (options: { workspaceId: string }) => Promise<string[]>
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
    loginStart: (options: { toolId: AgentToolId }) => Promise<AgentToolLoginStartResult>
    loginInput: (options: { sessionId: string; value: string }) => Promise<{ success: boolean }>
    loginCancel: (options: { sessionId: string }) => Promise<{ success: boolean }>
    onLoginEvent: (callback: (event: AgentToolLoginEvent) => void) => () => void
  }
  projectMemory: {
    getStatus: (options: { workspaceId: string; laneId?: string | null }) => Promise<ProjectMemoryStatus>
    getGraph: (options: {
      workspaceId: string
      laneId?: string | null
    }) => Promise<ProjectMemoryGraph | null>
    getNodeDetail: (options: {
      workspaceId: string
      laneId?: string | null
      nodeId: string
    }) => Promise<ProjectMemoryNodeDetail | null>
  }
  agentSkills: {
    list: () => Promise<AgentSkillsSnapshot>
    save: (draft: AgentSkillDraft) => Promise<AgentSkillMutationResult>
    setProviderEnabled: (options: {
      skillId: string
      provider: AgentSkillProvider
      enabled: boolean
    }) => Promise<AgentSkillMutationResult>
    /** Master switch: every compatible provider at once. */
    setEnabled: (options: { skillId: string; enabled: boolean }) => Promise<AgentSkillMutationResult>
    update: (options: { skillId: string }) => Promise<AgentSkillMutationResult>
    /** Copy a catalog skill into the provider's own skills folder. */
    install: (options: { skillId: string }) => Promise<AgentSkillMutationResult>
    saveBuild: (options: {
      buildId?: string
      name: string
      skillIds: string[]
    }) => Promise<AgentSkillMutationResult>
    deleteBuild: (options: { buildId: string }) => Promise<AgentSkillMutationResult>
    /** Turn on exactly this build's skills and turn every other one off. */
    applyBuild: (options: { buildId: string }) => Promise<AgentSkillMutationResult>
    copyToLibrary: (options: { skillId: string }) => Promise<AgentSkillMutationResult>
    remove: (options: { skillId: string }) => Promise<AgentSkillMutationResult>
    importDirectory: () => Promise<AgentSkillMutationResult>
    openSetupPack: () => Promise<AgentSkillSetupPackResult>
    copyFromSetupPack: (options: {
      pack: AgentSkillSetupPack
      packSkillId: string
    }) => Promise<AgentSkillMutationResult>
    exportSetupPack: (options: {
      setupName: string
      authorName: string
    }) => Promise<AgentSkillExportResult>
  }
  contextMenu: {
    showTerminalSelection: (options: {
      selectedText: string
      x: number
      y: number
    }) => Promise<{ action: string | null }>
    showFileTreeMenu: (options: {
      targetPath: string
      isDirectory: boolean
      x: number
      y: number
    }) => Promise<{ action: string | null }>
    showVisualEditorMenu: (options: {
      hasReactSource: boolean
      hasReactStack: boolean
      x: number
      y: number
    }) => Promise<{ action: string | null }>
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
    install: (options?: { continueActiveChats?: boolean }) => Promise<{ success: boolean; error?: string }>
    getState: () => Promise<UpdateState>
    onStatus: (callback: (state: UpdateState) => void) => () => void
  }
  workspace?: {
    resolveProject: (req: ResolveProjectWorkspaceRequest) => Promise<ResolveProjectWorkspaceResult>
    listForProject: (projectId: string) => Promise<LocalWorkspaceRecord[]>
    getActiveForProject: (projectId: string) => Promise<LocalWorkspaceRecord | null>
    setActiveForProject: (req: { workspaceId: string; projectId: string }) => Promise<void>
    bindExistingFolder: (req: BindExistingFolderRequest) => Promise<BindExistingFolderResult>
    preflightExistingFolder: (req: PreflightExistingFolderRequest) => Promise<PreflightExistingFolderResult>
    attachExistingFolder: (req: AttachExistingFolderRequest) => Promise<AttachExistingFolderResult>
    importExistingFolder: (req: ImportExistingFolderRequest) => Promise<ImportExistingFolderResult>
    createForProject: (req: CreateWorkspaceForProjectRequest) => Promise<CreateWorkspaceForProjectResult>
    cloneForProject: (req: CloneWorkspaceForProjectRequest) => Promise<CloneWorkspaceForProjectResult>
    verify: (workspaceId: string) => Promise<{ status: string; workspace: LocalWorkspaceDTO | null }>
    findByPath: (folderPath: string) => Promise<LocalWorkspaceDTO | null>
    trashManagedWorkspace: (workspaceId: string) => Promise<TrashManagedWorkspaceResult>
    forget: (workspaceId: string) => Promise<void>
    listCandidates: (req: {
      projectId: string
      slug: string
      roots: string[]
      expectedRepo?: unknown
    }) => Promise<WorkspaceCandidate[]>
    openInFinder: (folderPath: string) => Promise<void>
    getCatalogSnapshot: () => Promise<WorkspaceCatalogSnapshot>
    onCatalogSnapshotChanged: (callback: (snapshot: WorkspaceCatalogSnapshot) => void) => () => void
  }
}
