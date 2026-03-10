import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolvePathWithinDirectory } from '../pathUtils'
import { markInternalFsChange } from '../projectWatcher'
import { shouldExcludeGeneratedDirectory, shouldExcludeGeneratedFile } from './generatedArtifactFilters'
import { AuthService } from './AuthService'
import type {
  GitLfsGetObjectResult,
  GitLfsPutObjectResult,
  GitReplicaBootstrapResult,
  GitReplicaConflictDecision,
  GitReplicaEnqueueResult,
  GitReplicaExecuteResult,
  GitReplicaPlanResult,
  GitReplicaSnapshotFile,
  GitReplicaSnapshotSource,
  GitReplicaStatusResult,
} from '../../shared/electronApiTypes'

interface QueueEntry {
  id: string
  projectId: string
  projectPath: string
  source: GitReplicaSnapshotSource
  reason: string
  createdAt: number
}

interface ProjectReplicaLocalState {
  baseCommit?: string
  lastError?: string
  updatedAt: number
}

interface ReplicaStateFile {
  projects: Record<string, ProjectReplicaLocalState>
  queue: QueueEntry[]
}

const DEFAULT_REPLICA_API_BASE = 'https://api.cozea.app'
const SNAPSHOT_FLUSH_DEBOUNCE_MS = 2_000
const SNAPSHOT_RETRY_INITIAL_MS = 5_000
const SNAPSHOT_RETRY_MAX_MS = 60_000
const MAX_SNAPSHOT_FILE_BYTES = 8 * 1024 * 1024
const MAX_SNAPSHOT_TOTAL_BYTES = 60 * 1024 * 1024
const LFS_POINTER_VERSION = 'version https://git-lfs.github.com/spec/v1'
const REPLICA_LOCK_TIMEOUT_ERROR = 'Timed out waiting for replica lock'
const LOCK_TIMEOUT_RETRY_DELAYS_MS = [400, 1_200, 2_400]

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isLikelyBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'svg',
    'pdf', 'zip', 'gz', 'tar', 'rar', '7z',
    'mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'webm',
    'ttf', 'otf', 'woff', 'woff2', 'eot', 'wasm',
  ].includes(ext)
}

function containsNullByte(bytes: Buffer): boolean {
  const length = Math.min(bytes.length, 2048)
  for (let i = 0; i < length; i += 1) {
    if (bytes[i] === 0) return true
  }
  return false
}

function parseLfsPointerBuffer(bytes: Buffer): { oid: string; size: number } | null {
  const text = bytes.toString('utf-8')
  if (!text.startsWith(LFS_POINTER_VERSION)) return null
  const oidMatch = text.match(/^oid sha256:([a-f0-9]{64})$/m)
  const sizeMatch = text.match(/^size ([0-9]+)$/m)
  if (!oidMatch || !sizeMatch) return null
  const size = Number(sizeMatch[1])
  if (!Number.isFinite(size) || size < 0) return null
  return {
    oid: oidMatch[1],
    size,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isReplicaAccessDeniedMessage(message: string | undefined): boolean {
  if (!message) return false
  return (
    /not a member of this project/i.test(message) ||
    (/\b403\b/.test(message) && /member/i.test(message))
  )
}

function isReplicaEntitlementRequiredMessage(message: string | undefined): boolean {
  if (!message) return false
  return (
    /entitlement_required/i.test(message) ||
    /subscription required/i.test(message) ||
    /seat assignment required/i.test(message) ||
    (/\b402\b/.test(message) && /replica api/i.test(message))
  )
}

export class GitReplicaService {
  private static instance: GitReplicaService

  private readonly apiBase: string
  private readonly flushTimers = new Map<string, NodeJS.Timeout>()
  private readonly retryTimers = new Map<string, NodeJS.Timeout>()
  private readonly retryDelays = new Map<string, number>()
  private readonly inFlightProjects = new Set<string>()
  private stateLoaded = false
  private state: ReplicaStateFile = {
    projects: {},
    queue: [],
  }

  private constructor() {
    this.apiBase = (process.env.AUTH_SERVER_URL || DEFAULT_REPLICA_API_BASE).replace(/\/+$/, '')
  }

  static getInstance(): GitReplicaService {
    if (!GitReplicaService.instance) {
      GitReplicaService.instance = new GitReplicaService()
    }
    return GitReplicaService.instance
  }

  private getStatePath(): string {
    return path.join(app.getPath('userData'), 'git-replica-state.json')
  }

  private ensureStateLoaded(): void {
    if (this.stateLoaded) return
    this.stateLoaded = true
    try {
      const statePath = this.getStatePath()
      if (!fs.existsSync(statePath)) return
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Partial<ReplicaStateFile>
      this.state = {
        projects: parsed.projects && typeof parsed.projects === 'object'
          ? parsed.projects as Record<string, ProjectReplicaLocalState>
          : {},
        queue: Array.isArray(parsed.queue)
          ? parsed.queue
              .filter((entry): entry is QueueEntry =>
                Boolean(
                  entry &&
                  typeof entry === 'object' &&
                  typeof (entry as QueueEntry).projectId === 'string' &&
                  typeof (entry as QueueEntry).projectPath === 'string' &&
                  typeof (entry as QueueEntry).reason === 'string'
                )
              )
          : [],
      }
    } catch (error) {
      console.warn('[GitReplica] Failed to load local state:', error)
      this.state = { projects: {}, queue: [] }
    }

    // Resume pending snapshot work after app restart/crash.
    const projectIds = new Set(this.state.queue.map((entry) => entry.projectId))
    for (const projectId of projectIds) {
      this.scheduleQueueFlush(projectId)
    }
  }

  private persistState(): void {
    this.ensureStateLoaded()
    try {
      fs.writeFileSync(this.getStatePath(), JSON.stringify(this.state, null, 2), 'utf-8')
    } catch (error) {
      console.warn('[GitReplica] Failed to persist local state:', error)
    }
  }

  private getProjectState(projectId: string): ProjectReplicaLocalState {
    this.ensureStateLoaded()
    const existing = this.state.projects[projectId]
    if (existing) return existing
    const created: ProjectReplicaLocalState = {
      updatedAt: Date.now(),
    }
    this.state.projects[projectId] = created
    return created
  }

  private updateProjectState(projectId: string, patch: Partial<ProjectReplicaLocalState>): void {
    const current = this.getProjectState(projectId)
    this.state.projects[projectId] = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }
    this.persistState()
  }

  private getAccessToken(): string {
    const session = AuthService.getInstance().loadSession()
    if (!session?.accessToken) {
      throw new Error('Missing authenticated session for replica API')
    }
    return session.accessToken
  }

  private isLockTimeoutMessage(message: string | undefined): boolean {
    if (!message) return false
    return message.toLowerCase().includes(REPLICA_LOCK_TIMEOUT_ERROR.toLowerCase())
  }

  private async postReplica<T>(route: string, body: Record<string, unknown>): Promise<T> {
    const token = this.getAccessToken()
    const response = await fetch(`${this.apiBase}/replica-git${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.warn('[GitReplica] Replica API request failed', {
        route,
        projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
        status: response.status,
        detail: detail || response.statusText,
      })
      throw new Error(`Replica API ${route} failed (${response.status}): ${detail || response.statusText}`)
    }

    return await response.json() as T
  }

  private async postReplicaWithLockRetry<T extends { success: boolean; error?: string }>(
    route: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const totalAttempts = LOCK_TIMEOUT_RETRY_DELAYS_MS.length + 1

    for (let attemptIndex = 0; attemptIndex < totalAttempts; attemptIndex += 1) {
      try {
        const response = await this.postReplica<T>(route, body)
        const shouldRetry =
          !response.success &&
          this.isLockTimeoutMessage(response.error) &&
          attemptIndex < LOCK_TIMEOUT_RETRY_DELAYS_MS.length

        if (!shouldRetry) {
          return response
        }

        const retryDelayMs = LOCK_TIMEOUT_RETRY_DELAYS_MS[attemptIndex]
        console.warn('[GitReplica] Replica lock contention, retrying request', {
          route,
          attempt: attemptIndex + 1,
          totalAttempts,
          retryDelayMs,
        })
        await delay(retryDelayMs)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const shouldRetry =
          this.isLockTimeoutMessage(message) &&
          attemptIndex < LOCK_TIMEOUT_RETRY_DELAYS_MS.length
        if (!shouldRetry) {
          throw error
        }

        const retryDelayMs = LOCK_TIMEOUT_RETRY_DELAYS_MS[attemptIndex]
        console.warn('[GitReplica] Replica lock contention (request failed), retrying', {
          route,
          attempt: attemptIndex + 1,
          totalAttempts,
          retryDelayMs,
        })
        await delay(retryDelayMs)
      }
    }

    throw new Error(`Replica API ${route} failed after retry attempts`)
  }

  private collectSnapshot(projectPath: string): GitReplicaSnapshotFile[] {
    const files: GitReplicaSnapshotFile[] = []
    let totalBytes = 0

    const walk = (dir: string, relDir = ''): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        if (entry.name === '.git') continue
        if (entry.isDirectory() && shouldExcludeGeneratedDirectory(entry.name)) continue

        const relPath = normalizePath(path.join(relDir, entry.name))
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walk(fullPath, relPath)
          continue
        }

        if (!entry.isFile()) continue
        if (shouldExcludeGeneratedFile(relPath)) continue

        const stats = fs.statSync(fullPath)
        if (stats.size > MAX_SNAPSHOT_FILE_BYTES) continue
        if (totalBytes + stats.size > MAX_SNAPSHOT_TOTAL_BYTES) return

        const bytes = fs.readFileSync(fullPath)
        totalBytes += bytes.byteLength
        const isBinary = isLikelyBinaryPath(relPath) || containsNullByte(bytes)
        files.push({
          path: relPath,
          contentBase64: bytes.toString('base64'),
          isBinary,
          size: stats.size,
          hash: sha256Hex(bytes),
        })
      }
    }

    walk(projectPath)
    files.sort((a, b) => a.path.localeCompare(b.path))
    return files
  }

  private async applyWorkspacePatch(
    projectId: string,
    projectPath: string,
    patch: NonNullable<GitReplicaExecuteResult['workspacePatch']>
  ): Promise<void> {
    console.log('[GitReplica] Applying workspace patch', {
      projectId,
      projectPath,
      entries: patch.length,
    })
    for (const entry of patch) {
      const fullPath = resolvePathWithinDirectory(projectPath, entry.path)
      if (entry.deleted) {
        if (fs.existsSync(fullPath)) {
          markInternalFsChange(fullPath)
          fs.rmSync(fullPath, { force: true })
        }
        continue
      }
      if (!entry.contentBase64) continue
      const patchBytes = Buffer.from(entry.contentBase64, 'base64')
      const lfsPointer = parseLfsPointerBuffer(patchBytes)

      let writeBytes = patchBytes
      if (lfsPointer) {
        console.log('[GitReplica] Resolving LFS object for workspace patch entry', {
          projectId,
          path: entry.path,
          oid: lfsPointer.oid,
          size: lfsPointer.size,
        })
        const lfsResult = await this.getLfsObject({
          projectId,
          oid: lfsPointer.oid,
        })
        if (lfsResult.success && lfsResult.contentBase64) {
          writeBytes = Buffer.from(lfsResult.contentBase64, 'base64')
        } else {
          throw new Error(
            lfsResult.error || `Failed to resolve LFS object ${lfsPointer.oid} for ${entry.path}`
          )
        }
      }

      try {
        markInternalFsChange(fullPath)
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, writeBytes)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown write error'
        throw new Error(`Failed to write restored file ${entry.path}: ${message}`)
      }
    }
  }

  async bootstrap(options: {
    projectId: string
    projectPath: string
    sessionId?: string
  }): Promise<GitReplicaBootstrapResult> {
    try {
      const localSnapshot = this.collectSnapshot(options.projectPath)
      const response = await this.postReplicaWithLockRetry<GitReplicaBootstrapResult>('/bootstrap', {
        projectId: options.projectId,
        localSnapshot,
      })
      if (response.success) {
        this.updateProjectState(options.projectId, { lastError: undefined })
      } else {
        console.warn('[GitReplica] Bootstrap returned unsuccessful result', {
          projectId: options.projectId,
          projectPath: options.projectPath,
          snapshotCount: localSnapshot.length,
          error: response.error,
        })
        this.updateProjectState(options.projectId, { lastError: response.error || 'Bootstrap failed' })
      }
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bootstrap failed'
      console.error('[GitReplica] Bootstrap request failed', {
        projectId: options.projectId,
        projectPath: options.projectPath,
        error,
      })
      this.updateProjectState(options.projectId, { lastError: message })
      return {
        success: false,
        error: message,
      }
    }
  }

  async plan(options: {
    projectId: string
    projectPath: string
    sessionId?: string
  }): Promise<GitReplicaPlanResult> {
    const sessionId = options.sessionId?.trim() || randomUUID()
    try {
      const projectState = this.getProjectState(options.projectId)
      const localSnapshot = this.collectSnapshot(options.projectPath)
      const response = await this.postReplicaWithLockRetry<GitReplicaPlanResult>('/plan', {
        projectId: options.projectId,
        sessionId,
        baseCommit: projectState.baseCommit,
        localSnapshot,
        deviceId: process.env.HOSTNAME || process.env.COMPUTERNAME || process.platform,
      })
      if (response.success) {
        this.updateProjectState(options.projectId, { lastError: undefined })
      } else {
        console.warn('[GitReplica] Plan returned unsuccessful result', {
          projectId: options.projectId,
          projectPath: options.projectPath,
          sessionId,
          snapshotCount: localSnapshot.length,
          error: response.error,
        })
        this.updateProjectState(options.projectId, { lastError: response.error || 'Plan failed' })
      }
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plan failed'
      console.error('[GitReplica] Plan request failed', {
        projectId: options.projectId,
        projectPath: options.projectPath,
        sessionId,
        error,
      })
      this.updateProjectState(options.projectId, { lastError: message })
      return {
        success: false,
        sessionId,
        downloads: [],
        uploads: [],
        localDeletes: [],
        cloudDeletes: [],
        autoMerged: [],
        conflicts: [],
        noChange: 0,
        error: message,
      }
    }
  }

  async execute(options: {
    projectId: string
    projectPath: string
    sessionId: string
    conflictDecisions?: Record<string, GitReplicaConflictDecision>
  }): Promise<GitReplicaExecuteResult> {
    try {
      const projectState = this.getProjectState(options.projectId)
      const localSnapshot = this.collectSnapshot(options.projectPath)
      const response = await this.postReplicaWithLockRetry<GitReplicaExecuteResult>('/apply', {
        projectId: options.projectId,
        sessionId: options.sessionId,
        baseCommit: projectState.baseCommit,
        localSnapshot,
        conflictDecisions: options.conflictDecisions ?? {},
      })

      if (response.success && response.applied) {
        if (response.workspacePatch && response.workspacePatch.length > 0) {
          await this.applyWorkspacePatch(options.projectId, options.projectPath, response.workspacePatch)
        }
        this.updateProjectState(options.projectId, {
          baseCommit: response.canonicalHeadCommit ?? projectState.baseCommit,
          lastError: undefined,
        })
      } else if (!response.success || response.error) {
        this.updateProjectState(options.projectId, {
          lastError: response.error || 'Execute failed',
        })
      }

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execute failed'
      console.error('[GitReplica] Execute failed', {
        projectId: options.projectId,
        projectPath: options.projectPath,
        sessionId: options.sessionId,
        error: message,
      })
      this.updateProjectState(options.projectId, { lastError: message })
      return {
        success: false,
        applied: false,
        error: message,
      }
    }
  }

  async status(options: { projectId: string }): Promise<GitReplicaStatusResult> {
    this.ensureStateLoaded()
    const queued = this.state.queue.filter((entry) => entry.projectId === options.projectId).length
    const projectState = this.state.projects[options.projectId]
    try {
      const remote = await this.postReplica<Omit<GitReplicaStatusResult, 'pendingQueue'>>('/status', {
        projectId: options.projectId,
      })
      return {
        ...remote,
        pendingQueue: queued,
        degraded: remote.degraded || queued > 0,
        lastError: projectState?.lastError || remote.lastError,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch replica status'
      return {
        success: false,
        projectId: options.projectId,
        pendingQueue: queued,
        degraded: true,
        downloads: 0,
        uploads: 0,
        conflicts: 0,
        lastError: projectState?.lastError || message,
        error: message,
      }
    }
  }

  private scheduleQueueFlush(projectId: string): void {
    const existing = this.flushTimers.get(projectId)
    if (existing) {
      clearTimeout(existing)
    }
    const timer = setTimeout(() => {
      this.flushTimers.delete(projectId)
      void this.flushQueueForProject(projectId)
    }, SNAPSHOT_FLUSH_DEBOUNCE_MS)
    this.flushTimers.set(projectId, timer)
  }

  private clearRetry(projectId: string): void {
    const timer = this.retryTimers.get(projectId)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(projectId)
    }
    this.retryDelays.delete(projectId)
  }

  private scheduleRetry(projectId: string): void {
    if (this.retryTimers.has(projectId)) {
      return
    }

    const previousDelay = this.retryDelays.get(projectId) ?? 0
    const nextDelay = previousDelay > 0
      ? Math.min(previousDelay * 2, SNAPSHOT_RETRY_MAX_MS)
      : SNAPSHOT_RETRY_INITIAL_MS
    this.retryDelays.set(projectId, nextDelay)

    const timer = setTimeout(() => {
      this.retryTimers.delete(projectId)
      void this.flushQueueForProject(projectId)
    }, nextDelay)
    this.retryTimers.set(projectId, timer)
  }

  private async flushQueueForProject(projectId: string): Promise<void> {
    this.ensureStateLoaded()
    if (this.inFlightProjects.has(projectId)) return

    const entries = this.state.queue.filter((entry) => entry.projectId === projectId)
    if (entries.length === 0) return
    const latest = entries[entries.length - 1]
    this.inFlightProjects.add(projectId)

    try {
      await this.bootstrap({
        projectId,
        projectPath: latest.projectPath,
      })
      const plan = await this.plan({
        projectId,
        projectPath: latest.projectPath,
      })
      if (!plan.success) {
        throw new Error(plan.error || 'Replica plan failed')
      }
      if (plan.conflicts.length > 0) {
        this.updateProjectState(projectId, { lastError: 'Replica conflict requires explicit resolution.' })
        this.clearRetry(projectId)
        return
      }

      const execute = await this.execute({
        projectId,
        projectPath: latest.projectPath,
        sessionId: plan.sessionId,
      })
      if (!execute.success || !execute.applied) {
        throw new Error(execute.error || 'Replica apply failed')
      }

      this.state.queue = this.state.queue.filter((entry) => entry.projectId !== projectId)
      this.updateProjectState(projectId, { lastError: undefined })
      this.clearRetry(projectId)
      this.persistState()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Replica flush failed'
      this.updateProjectState(projectId, { lastError: message })
      if (isReplicaAccessDeniedMessage(message)) {
        console.warn('[GitReplica] Dropping queued replica sync for inaccessible project', {
          projectId,
          error: message,
        })
        this.state.queue = this.state.queue.filter((entry) => entry.projectId !== projectId)
        this.clearRetry(projectId)
        this.persistState()
        return
      }
      if (isReplicaEntitlementRequiredMessage(message)) {
        console.warn('[GitReplica] Dropping queued replica sync while cloud access is blocked by entitlement', {
          projectId,
          error: message,
        })
        this.state.queue = this.state.queue.filter((entry) => entry.projectId !== projectId)
        this.clearRetry(projectId)
        this.persistState()
        return
      }
      this.scheduleRetry(projectId)
    } finally {
      this.inFlightProjects.delete(projectId)
    }
  }

  async enqueueSnapshot(options: {
    projectId: string
    projectPath: string
    source: GitReplicaSnapshotSource
    reason: string
  }): Promise<GitReplicaEnqueueResult> {
    this.ensureStateLoaded()
    const now = Date.now()
    const existingForProject = this.state.queue.filter((entry) => entry.projectId === options.projectId)
    const mergedReason = existingForProject.length > 0
      ? `${existingForProject[existingForProject.length - 1].reason};${options.reason}`.slice(-512)
      : options.reason

    this.state.queue = this.state.queue.filter((entry) => entry.projectId !== options.projectId)
    this.state.queue.push({
      id: randomUUID(),
      projectId: options.projectId,
      projectPath: options.projectPath,
      source: options.source,
      reason: mergedReason,
      createdAt: now,
    })
    this.persistState()
    this.clearRetry(options.projectId)
    this.scheduleQueueFlush(options.projectId)

    return {
      success: true,
      queued: this.state.queue.filter((entry) => entry.projectId === options.projectId).length,
      enqueuedAt: now,
    }
  }

  async putLfsObject(options: {
    projectId: string
    oid: string
    size: number
    contentBase64: string
  }): Promise<GitLfsPutObjectResult> {
    try {
      return await this.postReplica<GitLfsPutObjectResult>('/lfs/upload', options)
    } catch (error) {
      return {
        success: false,
        oid: options.oid,
        size: options.size,
        error: error instanceof Error ? error.message : 'Failed to upload LFS object',
      }
    }
  }

  async getLfsObject(options: {
    projectId: string
    oid: string
  }): Promise<GitLfsGetObjectResult> {
    try {
      return await this.postReplica<GitLfsGetObjectResult>('/lfs/download', options)
    } catch (error) {
      return {
        success: false,
        oid: options.oid,
        error: error instanceof Error ? error.message : 'Failed to fetch LFS object',
      }
    }
  }
}
