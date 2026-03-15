import type {
  OrganizationMembership,
  Session,
} from './types'

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

export type DependencyType =
  | 'dependency'
  | 'devDependency'
  | 'optionalDependency'
  | 'peerDependency'

export interface DependencyItem {
  name: string
  type: DependencyType
  declared: string
  installed?: string
  wanted?: string
  latest?: string
  status: 'upToDate' | 'outdated' | 'missing' | 'unknown'
}

export interface DependencySnapshot {
  items: DependencyItem[]
  pm: PackageManager
  lastCheckedAt: number
  error?: string
}

export interface DependencyJobPayload {
  id: string
  action: 'add' | 'update' | 'remove'
  packageName: string
  status: 'running' | 'success' | 'error'
  startedAt: number
  finishedAt?: number
  stdout?: string
  stderr?: string
  error?: string
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

export interface DependenciesInspectResult {
  success: boolean
  snapshot?: DependencySnapshot
  error?: string
}

export interface DependenciesRunResult {
  success: boolean
  jobId?: string
  error?: string
}

export interface DependenciesRegistrySearchResult {
  success: boolean
  results?: {
    objects: Array<{
      package: {
        name: string
        version: string
        description?: string
        links?: Record<string, string>
      }
      score?: { final?: number }
      searchScore?: number
    }>
    total?: number
  }
  error?: string
}

export interface DependenciesFetchPackageMetaResult {
  success: boolean
  results?: Record<string, { latest?: string; description?: string }>
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

export interface PreviewCaptureScreenshotResult {
  success: boolean
  base64?: string
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
  fastForward?: boolean
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
}

export interface TerminalOutputEvent {
  terminalId: string
  data: string
  runId?: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number | null
  runId?: string
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

export type ProviderAuthProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'github-copilot'
  | 'gitlab'
  | (string & {})
export type ProviderAuthMethod =
  | 'oauth'
  | 'api_key'
  | 'cloud_credentials'
  | 'device'
  | 'manual_code'
  | 'vertex'
  | 'gemini'
  | 'gemini_api_key'
export type ProviderAuthGoogleMode = 'vertex' | 'gemini'
export type ProviderAuthType = 'oauth' | 'local_token' | 'api_key' | 'cloud_credentials'

export interface ProviderCloudCredentials {
  kind?: string
  region?: string
  profile?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  projectId?: string
  location?: string
  accountId?: string
  gatewayId?: string
  serviceKey?: string
  audience?: string
  apiVersion?: string
  baseUrl?: string
  apiKey?: string
  apiToken?: string
  token?: string
  headers?: Record<string, string>
  extras?: Record<string, unknown>
}

export interface ProviderAuthRequestEnvelope {
  provider: ProviderAuthProvider
  authType: ProviderAuthType
  accessToken: string
  organizationId?: string
  expiresAt?: number
  accountId?: string
  google?: {
    mode: ProviderAuthGoogleMode
    projectId?: string
    location?: string
  }
  headers?: Record<string, string>
  baseUrl?: string
  cloud?: ProviderCloudCredentials
}

export interface ProviderAuthStatus {
  provider: ProviderAuthProvider
  connected: boolean
  authType?: ProviderAuthType
  expiresAt?: number
  accountId?: string
  googleMode?: ProviderAuthGoogleMode
  googleProjectId?: string
  googleLocation?: string
  cloudKind?: string
  lastError?: string
  updatedAt?: number
}

export interface ProviderAuthStatusChangedEvent {
  provider?: ProviderAuthProvider
  statuses: ProviderAuthStatus[]
  updatedAt: number
}

export interface ProviderAuthConnectResult {
  success: boolean
  status?: ProviderAuthStatus
  authorizationUrl?: string
  requiresManualCode?: boolean
  error?: string
}

export interface ProviderAuthDisconnectResult {
  success: boolean
  error?: string
}

export interface ProviderAuthRequestAuthResult {
  success: boolean
  envelope?: ProviderAuthRequestEnvelope
  error?: string
  code?: 'not_connected' | 'expired' | 'invalid' | 'refresh_failed'
}

export interface LocalAiRuntimeStatus {
  enabled: boolean
  running: boolean
  endpoint?: string
}

export interface DbSupabaseSelectResult {
  success: boolean
  rows?: unknown[]
  error?: string
}

export interface DbFirestoreDocument {
  id: string
  path: string
  createTime?: string
  updateTime?: string
  fields: Record<string, unknown>
}

export interface DbFirestoreListDocumentsResult {
  success: boolean
  documents?: DbFirestoreDocument[]
  nextPageToken?: string
  error?: string
}

export type ElectronWindowContext = 'main' | 'settings'

export type AuthRefreshFailureReason = 'expired' | 'retryable' | 'missing_session'

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
  providerAuth: {
    listProviders: () => Promise<Array<{
      provider: ProviderAuthProvider
      methods: ProviderAuthMethod[]
    }>>
    getStatus: (provider?: ProviderAuthProvider) => Promise<ProviderAuthStatus[]>
    connect: (options: {
      provider: ProviderAuthProvider
      method?: ProviderAuthMethod
      authorizationCode?: string
      credentialPath?: string
      apiKey?: string
      cloudCredentials?: ProviderCloudCredentials
    }) => Promise<ProviderAuthConnectResult>
    disconnect: (provider: ProviderAuthProvider) => Promise<ProviderAuthDisconnectResult>
    onStatusChanged: (callback: (event: ProviderAuthStatusChangedEvent) => void) => () => void
  }
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
    startOAuth: (options: { provider: string; orgId: string }) => Promise<{ success: boolean; error?: string }>
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
  database: {
    supabaseSelect: (options: {
      table: string
      select?: string
      limit?: number
      offset?: number
      orderBy?: string
      orderAscending?: boolean
      credentials?: { url: string; anonKey: string }
      encryptedCredentials?: string
      keyId?: string
    }) => Promise<DbSupabaseSelectResult>
    firestoreListDocuments: (options: {
      collection: string
      pageSize?: number
      pageToken?: string
      encryptedCredentials: string
      keyId: string
    }) => Promise<DbFirestoreListDocumentsResult>
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
    openExternal: (url: string) => Promise<{ success: boolean }>
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
    selectDirectory: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
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
  preview: {
    injectBridge: (options: { url: string; frameName?: string }) => Promise<PreviewInjectBridgeResult>
    probeUrl: (options: { url: string; timeoutMs?: number }) => Promise<PreviewProbeUrlResult>
    captureScreenshot: (options: { url: string; width?: number; height?: number }) => Promise<PreviewCaptureScreenshotResult>
  }
  project: {
    createFolder: (options: { slug: string; initGit?: boolean }) => Promise<CreateProjectFolderResult>
    cloneRepository: (options: {
      slug: string
      repoUrl: string
      provider: string
      branch?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => Promise<CloneRepositoryResult>
    getLocalPath: (options: string | { slug: string; projectId?: string }) => Promise<string | null>
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
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => Promise<GitSyncPullResult>
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
    input: (options: { terminalId: string; data: string }) => Promise<void>
    resize: (options: { terminalId: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    kill: (options: { terminalId: string }) => Promise<{ success: boolean }>
    getProfiles: () => Promise<TerminalProfile[]>
    list: (options: { projectPath: string }) => Promise<string[]>
    getInfo: (options: { terminalId: string }) => Promise<TerminalInfo | null>
    onOutput: (callback: (data: TerminalOutputEvent) => void) => () => void
    onExit: (callback: (data: TerminalExitEvent) => void) => () => void
  }
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) => Promise<{ action: string | null }>
    showFileTreeMenu: (options: { targetPath: string; isDirectory: boolean; x: number; y: number }) => Promise<{ action: string | null }>
    showNative: (options: {
      x: number
      y: number
      editable?: boolean
      selectionText?: string
      linkUrl?: string
    }) => Promise<{ shown: boolean }>
  }
  updates: {
    check: () => Promise<UpdateState>
    download: () => Promise<UpdateState>
    install: () => Promise<{ success: boolean; error?: string }>
    getState: () => Promise<UpdateState>
    onStatus: (callback: (state: UpdateState) => void) => () => void
  }
  dependencies: {
    inspect: (options: { projectPath: string }) => Promise<DependenciesInspectResult>
    run: (options: {
      projectPath: string
      action: 'add' | 'update' | 'remove'
      packageName: string
      version?: string
      dev?: boolean
      updateMode?: 'latest' | 'range'
    }) => Promise<DependenciesRunResult>
    searchRegistry: (options: { query: string; size?: number }) => Promise<DependenciesRegistrySearchResult>
    fetchPackageMeta: (options: { names: string[] }) => Promise<DependenciesFetchPackageMetaResult>
    onJobStatus: (callback: (payload: { projectPath: string; job: DependencyJobPayload }) => void) => () => void
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
  }
}
