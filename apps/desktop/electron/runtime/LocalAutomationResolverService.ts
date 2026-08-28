import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import type { DevCommandCandidate } from './devCommandCandidates'
import {
  selectDevCommandCandidate,
  type DevCommandCandidateScore,
  type DevCommandResolution,
} from './localAutomationResolver'

interface HelperResponse {
  requestId: string
  success: boolean
  engine?: 'coreml' | 'deterministic_fallback'
  scores?: DevCommandCandidateScore[]
  error?: string
}

interface PendingRequest {
  resolve: (response: HelperResponse) => void
  timeout: NodeJS.Timeout
}

interface ValidatedResolutionEntry {
  command: string
  candidateId: string
  validatedAt: string
}

interface ValidatedResolutionCache {
  version: 1
  entries: Record<string, ValidatedResolutionEntry>
}

interface WorkspaceRankingContext {
  fingerprint: string
  candidates: readonly DevCommandCandidate[]
}

const REQUEST_TIMEOUT_MS = 5_000
const HELPER_EXECUTABLE_NAME = 'cozea-local-automation-helper'
const MODEL_FILE_NAME = 'DevCommandRanker.mlmodel'
const CACHE_FILE_NAME = 'dev-command-resolutions.json'

function firstExistingPath(candidates: readonly string[]): string | null {
  return candidates.find((candidate) => candidate.length > 0 && fs.existsSync(candidate)) ?? null
}

function resolveSourcePackageRoot(): string | null {
  const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd()
  return firstExistingPath([
    path.resolve(process.cwd(), 'native/local-automation-helper'),
    path.resolve(appRoot, '../../native/local-automation-helper'),
    path.resolve(appRoot, 'native/local-automation-helper'),
  ])
}

function resolveHelperExecutable(): string | null {
  const sourceRoot = resolveSourcePackageRoot()
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  return firstExistingPath([
    process.env.COZEA_LOCAL_AUTOMATION_HELPER_PATH?.trim() ?? '',
    sourceRoot ? path.join(sourceRoot, '.build', 'debug', HELPER_EXECUTABLE_NAME) : '',
    sourceRoot ? path.join(sourceRoot, '.build', 'release', HELPER_EXECUTABLE_NAME) : '',
    resourcesPath ? path.join(resourcesPath, 'local-automation', HELPER_EXECUTABLE_NAME) : '',
  ])
}

function resolveModelPath(): string | null {
  const sourceRoot = resolveSourcePackageRoot()
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  return firstExistingPath([
    process.env.COZEA_LOCAL_AUTOMATION_MODEL_PATH?.trim() ?? '',
    sourceRoot ? path.join(sourceRoot, 'Models', MODEL_FILE_NAME) : '',
    resourcesPath ? path.join(resourcesPath, 'local-automation', MODEL_FILE_NAME) : '',
  ])
}

export class LocalAutomationResolverService {
  private static instance: LocalAutomationResolverService | null = null

  public static getInstance(): LocalAutomationResolverService {
    if (!LocalAutomationResolverService.instance) {
      LocalAutomationResolverService.instance = new LocalAutomationResolverService()
    }
    return LocalAutomationResolverService.instance
  }

  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<ChildProcessWithoutNullStreams | null> | null = null
  private nextRequestId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly workspaceContexts = new Map<string, WorkspaceRankingContext>()
  private validatedCache: ValidatedResolutionCache | null = null

  public async rankDevCommands(input: {
    workspaceId: string
    fingerprint: string
    candidates: readonly DevCommandCandidate[]
  }): Promise<DevCommandResolution> {
    const { workspaceId, fingerprint, candidates } = input
    if (candidates.length === 0) return selectDevCommandCandidate(candidates)
    this.workspaceContexts.set(workspaceId, { fingerprint, candidates })

    const validated = this.loadValidatedCache().entries[fingerprint]
    const validatedCandidate = validated
      ? candidates.find(
          (candidate) =>
            candidate.id === validated.candidateId && candidate.command === validated.command,
        )
      : null
    if (validatedCandidate) {
      return selectDevCommandCandidate(
        candidates,
        candidates.map((candidate) => ({
          candidateId: candidate.id,
          score: candidate.id === validatedCandidate.id ? 1 : 0,
        })),
        'validated_cache',
      )
    }

    const helper = await this.ensureStarted()
    if (!helper) return selectDevCommandCandidate(candidates)

    const requestId = `local_automation_${this.nextRequestId++}`
    const response = await new Promise<HelperResponse>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ requestId, success: false, error: 'Local automation helper timed out.' })
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, timeout })

      helper.stdin.write(`${JSON.stringify({
        requestId,
        task: 'rank_dev_commands',
        candidates: candidates.map((candidate) => ({
          candidateId: candidate.id,
          features: candidate.features,
        })),
      })}\n`)
    })

    if (!response.success || !response.scores) {
      return selectDevCommandCandidate(candidates)
    }

    return selectDevCommandCandidate(
      candidates,
      response.scores,
      response.engine === 'coreml' ? 'coreml' : 'deterministic_fallback',
    )
  }

  public recordSuccessfulCommand(workspaceId: string, command: string): void {
    const context = this.workspaceContexts.get(workspaceId)
    const candidate = context?.candidates.find((entry) => entry.command === command)
    if (!context || !candidate) return

    const cache = this.loadValidatedCache()
    cache.entries[context.fingerprint] = {
      command: candidate.command,
      candidateId: candidate.id,
      validatedAt: new Date().toISOString(),
    }
    this.writeValidatedCache(cache)
  }

  public dispose(): void {
    const helper = this.process
    this.process = null
    this.startPromise = null
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.resolve({ requestId, success: false, error: 'Local automation helper stopped.' })
    }
    this.pending.clear()
    this.workspaceContexts.clear()
    if (helper && !helper.killed) helper.kill()
  }

  private getCachePath(): string | null {
    try {
      if (!app.isReady()) return null
      return path.join(app.getPath('userData'), 'local-automation', CACHE_FILE_NAME)
    } catch {
      return null
    }
  }

  private loadValidatedCache(): ValidatedResolutionCache {
    if (this.validatedCache) return this.validatedCache
    const empty: ValidatedResolutionCache = { version: 1, entries: {} }
    const cachePath = this.getCachePath()
    if (!cachePath || !fs.existsSync(cachePath)) {
      this.validatedCache = empty
      return empty
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ValidatedResolutionCache
      this.validatedCache = parsed.version === 1 && parsed.entries ? parsed : empty
    } catch {
      this.validatedCache = empty
    }
    return this.validatedCache
  }

  private writeValidatedCache(cache: ValidatedResolutionCache): void {
    const cachePath = this.getCachePath()
    if (!cachePath) return
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      const temporaryPath = `${cachePath}.tmp`
      fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
      fs.renameSync(temporaryPath, cachePath)
    } catch (error) {
      console.warn(
        `[LocalAutomation] Failed to persist a validated resolution: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async ensureStarted(): Promise<ChildProcessWithoutNullStreams | null> {
    if (process.platform !== 'darwin') return null
    if (this.process && !this.process.killed) return this.process
    if (this.startPromise) return await this.startPromise

    this.startPromise = Promise.resolve().then(() => this.startHelper())
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private startHelper(): ChildProcessWithoutNullStreams | null {
    const executablePath = resolveHelperExecutable()
    if (!executablePath) return null

    const modelPath = resolveModelPath()
    const args = modelPath ? ['--model', modelPath] : []
    const helper = spawn(executablePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    this.process = helper

    const stdout = createInterface({ input: helper.stdout })
    stdout.on('line', (line) => {
      let response: HelperResponse
      try {
        response = JSON.parse(line) as HelperResponse
      } catch {
        return
      }
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })

    helper.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) console.warn(`[LocalAutomation] ${message.slice(0, 1_000)}`)
    })

    helper.once('exit', () => {
      if (this.process === helper) this.process = null
      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.resolve({ requestId, success: false, error: 'Local automation helper exited.' })
      }
      this.pending.clear()
    })
    helper.once('error', () => {
      if (this.process === helper) this.process = null
    })

    return helper
  }
}
