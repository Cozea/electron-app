import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, ipcMain } from 'electron'
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
} from 'ai'

interface LocalAiRuntimeStatus {
  enabled: boolean
  running: boolean
  endpoint?: string
}

const LOCAL_RUNTIME_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-cozea-provider-auth',
  'x-cozea-selected-provider',
  'x-cozea-ai-base-url',
  'x-cozea-timezone',
  'x-cozea-tz-offset-minutes',
].join(', ')

type LocalAiRuntimeProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'moonshotai'
  | 'moonshot'
  | 'github-copilot'
  | 'gitlab'
  | (string & {})

interface ProviderAuthEnvelope {
  provider: LocalAiRuntimeProvider | 'anthropic' | 'xai' | 'moonshotai' | 'moonshot' | 'github-copilot' | 'gitlab' | (string & {})
  accessToken: string
  authType?: 'oauth' | 'local_token' | 'api_key' | 'cloud_credentials'
  organizationId?: string
  expiresAt?: number
  accountId?: string
  google?: {
    mode: 'vertex' | 'gemini'
    projectId?: string
    location?: string
  }
  headers?: Record<string, string>
  baseUrl?: string
  cloud?: Record<string, unknown>
}

interface ChatRequestBody {
  messages: unknown[]
  model: string
  organizationId: string
  requestId?: string
  conversationId?: string
  providerOptions?: Record<string, unknown>
  projectContext?: unknown
  agentId?: string
  surface?: string
  variantId?: string
  enableTools?: boolean
  enableWebSearch?: boolean
}

interface ChatContractFailure {
  ok: false
  error: {
    statusCode: number
    payload: Record<string, unknown>
  }
}

interface ChatContractSuccess {
  ok: true
  value: ChatRequestBody
}

type ChatContractResult = ChatContractFailure | ChatContractSuccess

interface ModelInfo {
  provider: string
  providerModelId: string
  tier?: 'fast' | 'standard' | 'powerful' | (string & {})
  cost?: {
    input?: number
    output?: number
  }
  capabilities?: Record<string, unknown>
}

interface RemotePricing {
  inputPer1m: number
  outputPer1m: number
}

interface RemotePricingResponse {
  pricing?: Array<{
    modelId?: unknown
    provider?: unknown
    pricing?: {
      inputPer1m?: unknown
      outputPer1m?: unknown
    }
  }>
}

interface WalletReserveResponse {
  ok?: boolean
  holdId?: string
  reason?: string
  availableCents?: number
  requiredCents?: number
}

interface WalletCaptureResponse {
  ok?: boolean
  reason?: string
}

interface ManagedEnvelopeFetchResult {
  envelope: ProviderAuthEnvelope | null
  errorStatus?: number
  errorCode?: string
  errorMessage?: string
}

interface CachedPricingEntry {
  pricing: RemotePricing
  expiresAt: number
}

interface LocalRuntimeDeps {
  getModelInfo: (modelId: string) => ModelInfo | undefined
  normalizeModelVariant: (args: {
    requestedVariant: string | undefined
    provider: string
    modelId: string
    capabilities?: Record<string, unknown>
  }) => string | undefined
  resolveAgentPolicy: (args: {
    requestedAgentId?: string
    requestedSurface?: string
    requestedVariantId?: string
    hasProjectContext: boolean
  }) => {
    ok: boolean
    value?: {
      variantId?: string
      [key: string]: unknown
    }
    error?: string
  }
  createProviderModelFromEnvelope: (
    provider: LocalAiRuntimeProvider,
    providerModelId: string,
    envelope: ProviderAuthEnvelope
  ) => unknown
  parseChatRequestBody: (raw: unknown) => ChatContractResult
  executeChatPipeline: (args: Record<string, unknown>) => Promise<{
    result: unknown
    requestMessages: unknown
    continuationStateInput: unknown
    providerHint: unknown
  }>
  mergePipelineResultToWriter: (args: Record<string, unknown>) => void
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isLocalRuntimeEnabled(): boolean {
  const raw = process.env.AI_LOCAL_RUNTIME_ENABLED
  if (!raw || raw.trim().length === 0) {
    // Electron desktop defaults to local AI execution unless explicitly disabled.
    return true
  }
  return envFlagEnabled(raw)
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', LOCAL_RUNTIME_ALLOWED_HEADERS)
  res.end(body)
}

function getHeaderValue(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key]
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0)
    if (first) return first.trim()
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MANAGED_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'google',
  'xai',
  'moonshotai',
  'moonshot',
])

function isManagedProvider(providerId: string): boolean {
  return MANAGED_PROVIDER_IDS.has(providerId.trim().toLowerCase())
}

function parseScopedModelId(modelId: string): { provider: string; providerModelId: string } | null {
  const trimmed = modelId.trim()
  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null
  }

  const provider = trimmed.slice(0, separatorIndex).trim().toLowerCase()
  const providerModelId = trimmed.slice(separatorIndex + 1).trim()
  if (!provider || !providerModelId) {
    return null
  }

  return {
    provider,
    providerModelId,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function stripChatSuffix(value: string): string {
  return value.replace(/\/chat\/?$/i, '')
}

function resolveRemoteAiBaseUrl(headerValue?: string): string {
  const candidate = typeof headerValue === 'string' ? headerValue.trim() : ''
  if (candidate && isHttpUrl(candidate)) {
    return stripChatSuffix(candidate).replace(/\/+$/, '')
  }

  const configured = (
    process.env.COZEA_AI_API_URL ||
    process.env.VITE_AI_API_URL ||
    process.env.AI_API_URL ||
    ''
  ).trim()
  if (configured && isHttpUrl(configured)) {
    return stripChatSuffix(configured).replace(/\/+$/, '')
  }

  return app.isPackaged
    ? 'https://api.cozea.app/ai'
    : 'http://localhost:3001/ai'
}

function parseProviderAuthEnvelope(encodedHeader: string | undefined): ProviderAuthEnvelope | null {
  if (!encodedHeader) return null
  try {
    const decoded = Buffer.from(encodedHeader, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as Partial<ProviderAuthEnvelope>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.provider !== 'string' || parsed.provider.trim().length === 0) return null
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0) return null
    if (typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt) && Date.now() >= parsed.expiresAt) {
      return null
    }
    return {
      ...parsed,
      provider: parsed.provider.trim().toLowerCase(),
      accessToken: parsed.accessToken,
    } as ProviderAuthEnvelope
  } catch {
    return null
  }
}

class RemoteAiHttpError extends Error {
  readonly statusCode: number
  readonly payload: Record<string, unknown>

  constructor(statusCode: number, payload: Record<string, unknown>) {
    super(typeof payload.message === 'string' ? payload.message : `Remote AI request failed (${statusCode}).`)
    this.statusCode = statusCode
    this.payload = payload
  }
}

function normalizeRemotePayload(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return { message: value }
  }
  return {}
}

function managedReserveCentsForTier(tier: string | undefined): number {
  if (tier === 'fast') return 25
  if (tier === 'standard') return 75
  return 250
}

function resolveRequestId(candidate: string | undefined): string {
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim()
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function normalizePricingNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value)
  if (parsed === undefined) return null
  return Math.max(0, parsed)
}

export class LocalAiRuntimeService {
  private static instance: LocalAiRuntimeService | null = null

  private server: ReturnType<typeof createServer> | null = null
  private endpoint: string | null = null
  private runtimeDeps: LocalRuntimeDeps | null = null
  private readonly pricingCache = new Map<string, CachedPricingEntry>()

  static getInstance(): LocalAiRuntimeService {
    if (!LocalAiRuntimeService.instance) {
      LocalAiRuntimeService.instance = new LocalAiRuntimeService()
    }
    return LocalAiRuntimeService.instance
  }

  async getStatus(): Promise<LocalAiRuntimeStatus> {
    if (!isLocalRuntimeEnabled()) {
      return { enabled: false, running: false }
    }
    const deps = await this.loadRuntimeDeps()
    if (!deps) {
      return { enabled: false, running: false }
    }
    await this.ensureServer(deps)
    return {
      enabled: true,
      running: this.server !== null,
      endpoint: this.endpoint || undefined,
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('localAiRuntime:getStatus', async () => this.getStatus())
  }

  private async loadRuntimeDeps(): Promise<LocalRuntimeDeps | null> {
    if (this.runtimeDeps) {
      return this.runtimeDeps
    }

    const rootCandidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(__dirname, '..', '..'),
      path.resolve(__dirname, '..', '..', '..'),
    ]

    const requiredRelativePaths = [
      'modelCatalog.js',
      'modelVariants.js',
      'providerHelpers.js',
      'runtime/profiles.js',
      'runtime/chatContract.js',
      'runtime/chatExecutor.js',
    ]

    for (const root of rootCandidates) {
      const aiDistDir = path.join(root, 'server', 'dist', 'routes', 'ai')
      const hasAllModules = requiredRelativePaths.every((rel) => existsSync(path.join(aiDistDir, rel)))
      if (!hasAllModules) {
        continue
      }

      try {
        const [
          modelCatalogModule,
          modelVariantsModule,
          profilesModule,
          providerHelpersModule,
          chatContractModule,
          chatExecutorModule,
        ] = await Promise.all([
          import(pathToFileURL(path.join(aiDistDir, 'modelCatalog.js')).href),
          import(pathToFileURL(path.join(aiDistDir, 'modelVariants.js')).href),
          import(pathToFileURL(path.join(aiDistDir, 'runtime', 'profiles.js')).href),
          import(pathToFileURL(path.join(aiDistDir, 'providerHelpers.js')).href),
          import(pathToFileURL(path.join(aiDistDir, 'runtime', 'chatContract.js')).href),
          import(pathToFileURL(path.join(aiDistDir, 'runtime', 'chatExecutor.js')).href),
        ])

        this.runtimeDeps = {
          getModelInfo: modelCatalogModule.getModelInfo as LocalRuntimeDeps['getModelInfo'],
          normalizeModelVariant: modelVariantsModule.normalizeModelVariant as LocalRuntimeDeps['normalizeModelVariant'],
          resolveAgentPolicy: profilesModule.resolveAgentPolicy as LocalRuntimeDeps['resolveAgentPolicy'],
          createProviderModelFromEnvelope: providerHelpersModule.createProviderModelFromEnvelope as LocalRuntimeDeps['createProviderModelFromEnvelope'],
          parseChatRequestBody: chatContractModule.parseChatRequestBody as LocalRuntimeDeps['parseChatRequestBody'],
          executeChatPipeline: chatExecutorModule.executeChatPipeline as LocalRuntimeDeps['executeChatPipeline'],
          mergePipelineResultToWriter: chatExecutorModule.mergePipelineResultToWriter as LocalRuntimeDeps['mergePipelineResultToWriter'],
        }
        return this.runtimeDeps
      } catch (error) {
        console.warn('Failed to initialize local AI runtime server modules from', aiDistDir, error)
      }
    }

    return null
  }

  private async fetchManagedProviderEnvelope(args: {
    authorization: string
    organizationId: string
    model: string
    provider: string
    aiBaseUrlHeader?: string
  }): Promise<ManagedEnvelopeFetchResult> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/provider-auth/managed`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: args.authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: args.organizationId,
          model: args.model,
          provider: args.provider,
        }),
      })
      if (!response.ok) {
        let errorCode: string | undefined
        let errorMessage: string | undefined
        try {
          const parsed = (await response.json()) as { error?: unknown; message?: unknown }
          if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
            errorCode = parsed.error
          }
          if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
            errorMessage = parsed.message
          }
        } catch {
          // best effort only
        }
        return {
          envelope: null,
          errorStatus: response.status,
          ...(errorCode ? { errorCode } : {}),
          ...(errorMessage ? { errorMessage } : {}),
        }
      }
      const parsed = await response.json() as { envelope?: unknown }
      if (!parsed || typeof parsed !== 'object' || !parsed.envelope) {
        return {
          envelope: null,
          errorStatus: 503,
          errorCode: 'managed_provider_unavailable',
          errorMessage: 'Managed provider envelope was not returned by the server.',
        }
      }
      const encoded = Buffer.from(JSON.stringify(parsed.envelope), 'utf8').toString('base64')
      const envelope = parseProviderAuthEnvelope(encoded)
      if (!envelope) {
        return {
          envelope: null,
          errorStatus: 503,
          errorCode: 'managed_provider_invalid_envelope',
          errorMessage: 'Managed provider returned an invalid or expired auth envelope.',
        }
      }
      return {
        envelope,
      }
    } catch {
      return {
        envelope: null,
        errorStatus: 503,
        errorCode: 'managed_provider_unreachable',
        errorMessage: 'Unable to reach managed provider auth endpoint.',
      }
    }
  }

  private async fetchModelInfoFromRemoteCatalog(args: {
    authorization: string
    organizationId: string
    model: string
    preferredProvider?: string
    aiBaseUrlHeader?: string
  }): Promise<ModelInfo | null> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const preferredProvider = args.preferredProvider?.trim().toLowerCase() || ''
    const query = new URLSearchParams({
      organizationId: args.organizationId,
    })
    if (preferredProvider) {
      query.set('providers', preferredProvider)
    }
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models?${query.toString()}`

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: args.authorization,
        },
      })
      if (!response.ok) {
        return null
      }

      const parsed = await response.json() as { models?: unknown }
      if (!parsed || !Array.isArray(parsed.models)) {
        return null
      }

      const requestedScoped = args.model.trim()
      const requested = parseScopedModelId(requestedScoped)
      if (!requested) {
        return null
      }

      const normalizedRows = parsed.models
        .map((entry) => {
          if (!isRecord(entry)) return null

          const scopedId = typeof entry.id === 'string' ? entry.id.trim() : ''
          if (!scopedId) return null

          const slashIndex = scopedId.indexOf('/')
          const providerFromField =
            typeof entry.provider === 'string' && entry.provider.trim().length > 0
              ? entry.provider.trim().toLowerCase()
              : ''
          const provider =
            providerFromField ||
            (slashIndex > 0 ? scopedId.slice(0, slashIndex).trim().toLowerCase() : '')
          const providerModelId =
            slashIndex > 0 && slashIndex < scopedId.length - 1
              ? scopedId.slice(slashIndex + 1).trim()
              : scopedId
          if (!provider || !providerModelId) return null

          return {
            scopedId,
            provider,
            providerModelId,
            capabilities: isRecord(entry.capabilities) ? entry.capabilities : undefined,
          }
        })
        .filter((entry): entry is {
          scopedId: string
          provider: string
          providerModelId: string
          capabilities?: Record<string, unknown>
        } => entry !== null)

      const exactMatch = normalizedRows.find((row) => {
        if (row.scopedId !== requestedScoped) return false
        if (row.provider !== requested.provider) return false
        if (row.providerModelId !== requested.providerModelId) return false
        if (preferredProvider && row.provider !== preferredProvider) return false
        return true
      })
      if (exactMatch) {
        return {
          provider: exactMatch.provider,
          providerModelId: exactMatch.providerModelId,
          ...(exactMatch.capabilities ? { capabilities: exactMatch.capabilities } : {}),
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async fetchRemoteJson(args: {
    authorization: string
    endpoint: string
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const response = await fetch(args.endpoint, {
      method: args.method ?? 'GET',
      headers: {
        Authorization: args.authorization,
        ...(args.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(args.body ? { body: JSON.stringify(args.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    })

    let payload: Record<string, unknown> = {}
    try {
      const parsed = await response.json()
      payload = normalizeRemotePayload(parsed)
    } catch {
      payload = {}
    }

    if (!response.ok) {
      throw new RemoteAiHttpError(response.status, payload)
    }

    return payload
  }

  private async reserveManagedWalletHold(args: {
    authorization: string
    organizationId: string
    requestId: string
    estimatedCents: number
    feature?: string
    model: string
    provider: string
    aiBaseUrlHeader?: string
  }): Promise<WalletReserveResponse> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/wallet/reserve`
    return (await this.fetchRemoteJson({
      authorization: args.authorization,
      endpoint,
      method: 'POST',
      body: {
        organizationId: args.organizationId,
        requestId: args.requestId,
        estimatedCents: Math.max(1, Math.ceil(args.estimatedCents)),
        ...(args.feature ? { feature: args.feature } : {}),
        model: args.model,
        provider: args.provider,
      },
    })) as WalletReserveResponse
  }

  private async captureManagedWalletHold(args: {
    authorization: string
    holdId: string
    finalCents: number
    aiBaseUrlHeader?: string
  }): Promise<WalletCaptureResponse> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/wallet/debit`
    return (await this.fetchRemoteJson({
      authorization: args.authorization,
      endpoint,
      method: 'POST',
      body: {
        holdId: args.holdId,
        finalCents: Math.max(0, Math.ceil(args.finalCents)),
      },
    })) as WalletCaptureResponse
  }

  private async releaseManagedWalletHold(args: {
    authorization: string
    holdId: string
    reason: string
    aiBaseUrlHeader?: string
  }): Promise<WalletCaptureResponse> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/wallet/settle`
    return (await this.fetchRemoteJson({
      authorization: args.authorization,
      endpoint,
      method: 'POST',
      body: {
        holdId: args.holdId,
        action: 'release',
        reason: args.reason,
      },
    })) as WalletCaptureResponse
  }

  private async logLocalUsageToRemote(args: {
    authorization: string
    organizationId: string
    model: string
    provider?: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    reasoningTokens?: number
    cachedInputTokens?: number
    requestId?: string
    conversationId?: string
    feature?: string
    actionType?: string
    projectId?: string
    durationMs?: number
    finishReason?: string
    rawFinishReason?: string
    keySource: 'organization' | 'provider_auth'
    aiBaseUrlHeader?: string
  }): Promise<string | null> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/local/usage`

    try {
      const payload = await this.fetchRemoteJson({
        authorization: args.authorization,
        endpoint,
        method: 'POST',
        body: {
          organizationId: args.organizationId,
          model: args.model,
          ...(typeof args.provider === 'string' && args.provider.trim().length > 0
            ? { provider: args.provider.trim().toLowerCase() }
            : {}),
          promptTokens: Math.max(0, Math.floor(args.promptTokens)),
          completionTokens: Math.max(0, Math.floor(args.completionTokens)),
          totalTokens: Math.max(0, Math.floor(args.totalTokens)),
          ...(typeof args.reasoningTokens === 'number' ? { reasoningTokens: args.reasoningTokens } : {}),
          ...(typeof args.cachedInputTokens === 'number' ? { cachedInputTokens: args.cachedInputTokens } : {}),
          ...(args.requestId ? { requestId: args.requestId } : {}),
          ...(args.conversationId ? { conversationId: args.conversationId } : {}),
          ...(args.feature ? { feature: args.feature } : {}),
          ...(args.actionType ? { actionType: args.actionType } : {}),
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(typeof args.durationMs === 'number' ? { durationMs: args.durationMs } : {}),
          ...(args.finishReason ? { finishReason: args.finishReason } : {}),
          ...(args.rawFinishReason ? { rawFinishReason: args.rawFinishReason } : {}),
          keySource: args.keySource,
        },
      })

      if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
        return payload.error
      }
      return null
    } catch (error) {
      if (error instanceof RemoteAiHttpError) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          return 'Usage tracking endpoint is unavailable on the server. Deploy the latest AI routes.'
        }

        if (typeof error.payload.message === 'string' && error.payload.message.trim().length > 0) {
          return error.payload.message.trim()
        }
        if (typeof error.payload.error === 'string' && error.payload.error.trim().length > 0) {
          return error.payload.error.trim()
        }
        return `Failed to log local usage (${error.statusCode})`
      }
      return 'Failed to log local usage'
    }
  }

  private async lookupPricingFromRemote(args: {
    authorization: string
    model: string
    preferredProvider?: string
    aiBaseUrlHeader?: string
  }): Promise<RemotePricing | null> {
    const baseUrl = resolveRemoteAiBaseUrl(args.aiBaseUrlHeader)
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
    const preferredProvider = args.preferredProvider?.trim().toLowerCase() || ''
    const cacheKey = `${normalizedBaseUrl}|${preferredProvider || '*'}|${args.model}`
    const cached = this.pricingCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.pricing
    }

    const query = new URLSearchParams({
      model: args.model,
    })
    if (preferredProvider) {
      query.set('provider', preferredProvider)
    }
    const endpoint = `${normalizedBaseUrl}/pricing?${query.toString()}`
    const payload = (await this.fetchRemoteJson({
      authorization: args.authorization,
      endpoint,
      method: 'GET',
    })) as RemotePricingResponse

    const rows = Array.isArray(payload.pricing) ? payload.pricing : []
    const normalizedModel = args.model.trim().toLowerCase()

    const exactRow = rows.find((entry) => {
      const rowModelId = typeof entry?.modelId === 'string' ? entry.modelId.trim().toLowerCase() : ''
      if (!rowModelId) return false
      const rowProvider =
        typeof entry?.provider === 'string' ? entry.provider.trim().toLowerCase() : ''
      if (preferredProvider && rowProvider && rowProvider !== preferredProvider) return false
      return rowModelId === normalizedModel
    })
    const row = exactRow

    if (!row || !isRecord(row.pricing)) {
      return null
    }

    const inputPer1m = normalizePricingNumber(row.pricing.inputPer1m)
    const outputPer1m = normalizePricingNumber(row.pricing.outputPer1m)
    if (inputPer1m === null || outputPer1m === null) {
      return null
    }

    const pricing = { inputPer1m, outputPer1m }
    this.pricingCache.set(cacheKey, {
      pricing,
      expiresAt: Date.now() + 60_000,
    })

    return pricing
  }

  private resolvePricingFromModelInfo(modelInfo: ModelInfo): RemotePricing | null {
    const inputPer1m = normalizePricingNumber(modelInfo.cost?.input)
    const outputPer1m = normalizePricingNumber(modelInfo.cost?.output)
    if (inputPer1m === null || outputPer1m === null) {
      return null
    }
    return { inputPer1m, outputPer1m }
  }

  private calculateSpendCentsFromPricing(args: {
    promptTokens: number
    completionTokens: number
    cachedInputTokens: number
    pricing: RemotePricing
  }): number {
    const billableInputTokens = Math.max(0, Math.floor(args.promptTokens) - Math.floor(args.cachedInputTokens))
    const outputTokens = Math.max(0, Math.floor(args.completionTokens))
    const inputUsd = (billableInputTokens / 1_000_000) * args.pricing.inputPer1m
    const outputUsd = (outputTokens / 1_000_000) * args.pricing.outputPer1m
    const totalUsd = inputUsd + outputUsd

    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      return 0
    }

    return Math.max(0, Math.ceil(totalUsd * 100))
  }

  private async releaseManagedWalletHoldSafely(args: {
    authorization: string
    holdId: string
    reason: string
    aiBaseUrlHeader?: string
  }): Promise<void> {
    try {
      await this.releaseManagedWalletHold(args)
    } catch (error) {
      console.warn('Failed to release managed wallet hold:', error)
    }
  }

  private async ensureServer(runtimeDeps: LocalRuntimeDeps): Promise<void> {
    if (this.server && this.endpoint) return

    this.server = createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', LOCAL_RUNTIME_ALLOWED_HEADERS)
        res.end()
        return
      }

      const requestPath = (() => {
        try {
          return new URL(req.url || '/', 'http://127.0.0.1').pathname
        } catch {
          return req.url || ''
        }
      })()

      if (req.method !== 'POST' || (requestPath !== '/chat' && requestPath !== '/agent/run')) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      let walletHoldId: string | null = null
      let walletSettled = false
      let walletHoldAuthorization: string | null = null
      let walletHoldBaseUrlHeader: string | undefined

      try {
        const rawBody = await readRequestBody(req)
        let decodedBody: unknown
        try {
          decodedBody = JSON.parse(rawBody) as unknown
        } catch {
          sendJson(res, 400, {
            error: 'invalid_payload',
            message: 'Request body must be valid JSON.',
          })
          return
        }

        const contract = runtimeDeps.parseChatRequestBody(decodedBody)
        if (!contract.ok) {
          sendJson(res, contract.error.statusCode, contract.error.payload)
          return
        }

        const parsedBody = contract.value
        const messages = parsedBody.messages
        const model = parsedBody.model
        const scopedModel = parseScopedModelId(model)
        const organizationId = parsedBody.organizationId
        const enableTools = parsedBody.enableTools ?? true
        const enableWebSearch = parsedBody.enableWebSearch ?? false

        if (!scopedModel) {
          sendJson(res, 400, {
            error: 'invalid_model_id',
            code: 'SCOPED_MODEL_REQUIRED',
            message: 'Model must be provider-scoped (for example: "openai/gpt-5.2-codex").',
          })
          return
        }

        const aiBaseUrlHeader = getHeaderValue(req, 'x-cozea-ai-base-url')
        const authorization = getHeaderValue(req, 'authorization')
        const selectedProviderHint = getHeaderValue(req, 'x-cozea-selected-provider')?.trim().toLowerCase()

        if (selectedProviderHint && selectedProviderHint !== scopedModel.provider) {
          sendJson(res, 400, {
            error: 'provider_model_mismatch',
            code: 'PROVIDER_MODEL_MISMATCH',
            message:
              `Selected provider "${selectedProviderHint}" does not match model provider "${scopedModel.provider}".`,
          })
          return
        }

        let modelInfo = runtimeDeps.getModelInfo(model)
        if (
          authorization &&
          parsedBody.organizationId &&
          !modelInfo
        ) {
          modelInfo = await this.fetchModelInfoFromRemoteCatalog({
            authorization,
            organizationId: parsedBody.organizationId,
            model,
            preferredProvider: scopedModel.provider,
            aiBaseUrlHeader,
          })
        }
        if (!modelInfo) {
          sendJson(res, 400, { error: 'Unsupported model for local runtime' })
          return
        }

        if (modelInfo.provider.trim().toLowerCase() !== scopedModel.provider) {
          sendJson(res, 400, {
            error: 'provider_model_mismatch',
            code: 'PROVIDER_MODEL_MISMATCH',
            message:
              `Resolved model provider "${modelInfo.provider}" does not match requested provider "${scopedModel.provider}".`,
          })
          return
        }

        const encodedEnvelope = getHeaderValue(req, 'x-cozea-provider-auth')
        let envelope = parseProviderAuthEnvelope(encodedEnvelope)
        if (envelope && envelope.provider.trim().toLowerCase() !== modelInfo.provider.trim().toLowerCase()) {
          sendJson(res, 400, {
            error: 'provider_auth_provider_mismatch',
            code: 'PROVIDER_AUTH_PROVIDER_MISMATCH',
            message:
              `Provider auth is for "${envelope.provider}" but model requires "${modelInfo.provider}".`,
          })
          return
        }

        let managedEnvelopeError: {
          status: number
          code?: string
          message?: string
        } | null = null

        if (!envelope && isManagedProvider(modelInfo.provider)) {
          if (authorization && parsedBody.organizationId) {
            const managedEnvelope = await this.fetchManagedProviderEnvelope({
              authorization,
              organizationId: parsedBody.organizationId,
              model,
              provider: modelInfo.provider,
              aiBaseUrlHeader,
            })
            envelope = managedEnvelope.envelope
            if (!envelope && managedEnvelope.errorStatus) {
              managedEnvelopeError = {
                status: managedEnvelope.errorStatus,
                ...(managedEnvelope.errorCode ? { code: managedEnvelope.errorCode } : {}),
                ...(managedEnvelope.errorMessage ? { message: managedEnvelope.errorMessage } : {}),
              }
            }
          } else {
            managedEnvelopeError = {
              status: 401,
              code: 'unauthorized',
              message: 'Authentication is required to use managed providers.',
            }
          }
        }

        if (!envelope) {
          if (managedEnvelopeError) {
            sendJson(res, managedEnvelopeError.status, {
              error: managedEnvelopeError.code || 'provider_auth_required',
              message:
                managedEnvelopeError.message ||
                'Managed provider auth is unavailable for the selected model.',
            })
            return
          }
          sendJson(res, 402, {
            error: 'provider_auth_required',
            message:
              `This model uses the BYOK provider "${modelInfo.provider}". ` +
              'Switch to a Cozea-managed provider (recommended) or connect this provider in Settings > AI.',
          })
          return
        }

        const policyResult = runtimeDeps.resolveAgentPolicy({
          requestedAgentId: parsedBody.agentId,
          requestedSurface: parsedBody.surface,
          requestedVariantId: parsedBody.variantId,
          hasProjectContext: !!parsedBody.projectContext,
        })

        if (!policyResult.ok) {
          sendJson(res, 400, { error: 'invalid_policy', message: policyResult.error })
          return
        }

        const resolvedPolicyBase = policyResult.value
        const resolvedVariantId = runtimeDeps.normalizeModelVariant({
          requestedVariant: resolvedPolicyBase.variantId,
          provider: modelInfo.provider,
          modelId: model,
          capabilities: modelInfo.capabilities,
        })
        const resolvedPolicy = {
          ...resolvedPolicyBase,
          variantId: resolvedVariantId,
        }

        const managedProvider = isManagedProvider(modelInfo.provider)
        const requestId = resolveRequestId(parsedBody.requestId)
        const feature =
          typeof resolvedPolicy.feature === 'string' && resolvedPolicy.feature.trim().length > 0
            ? resolvedPolicy.feature
            : 'assistant'

        if (managedProvider) {
          if (!authorization) {
            sendJson(res, 401, { error: 'Unauthorized' })
            return
          }

          const reserveEstimatedCents = managedReserveCentsForTier(modelInfo.tier)
          try {
            const reserveResult = await this.reserveManagedWalletHold({
              authorization,
              organizationId,
              requestId,
              estimatedCents: reserveEstimatedCents,
              feature,
              model,
              provider: modelInfo.provider,
              aiBaseUrlHeader,
            })
            if (!reserveResult.ok || !reserveResult.holdId) {
              if (reserveResult.reason && reserveResult.reason !== 'insufficient_funds') {
                sendJson(res, 409, {
                  error: 'wallet_reservation_conflict',
                  code: reserveResult.reason === 'request_id_conflict'
                    ? 'WALLET_REQUEST_ID_CONFLICT'
                    : reserveResult.reason === 'hold_not_active'
                      ? 'WALLET_HOLD_NOT_ACTIVE'
                      : 'WALLET_RESERVE_CONFLICT',
                  message: reserveResult.reason === 'request_id_conflict'
                    ? 'Wallet hold request ID is already in use.'
                    : reserveResult.reason === 'hold_not_active'
                      ? 'Existing wallet hold for this request is no longer active.'
                      : 'Wallet reservation failed due to a hold conflict.',
                  reason: reserveResult.reason,
                  availableCents: reserveResult.availableCents,
                  requiredCents: reserveResult.requiredCents,
                })
                return
              }
              sendJson(res, 402, {
                error: 'wallet_insufficient_funds',
                message: 'Your available AI wallet balance is not enough for this request.',
              })
              return
            }
            walletHoldId = reserveResult.holdId
            walletHoldAuthorization = authorization
            walletHoldBaseUrlHeader = aiBaseUrlHeader
          } catch (error) {
            if (error instanceof RemoteAiHttpError) {
              sendJson(res, error.statusCode, error.payload)
              return
            }
            sendJson(res, 502, {
              error: 'wallet_reserve_failed',
              message: 'Failed to reserve AI wallet funds for this request.',
            })
            return
          }
        }

        let aiModel: unknown
        try {
          aiModel = runtimeDeps.createProviderModelFromEnvelope(
            modelInfo.provider as LocalAiRuntimeProvider,
            modelInfo.providerModelId,
            envelope
          )
        } catch (error) {
          if (walletHoldId && walletHoldAuthorization) {
            await this.releaseManagedWalletHoldSafely({
              authorization: walletHoldAuthorization,
              holdId: walletHoldId,
              reason: 'model_initialization_failed',
              aiBaseUrlHeader: walletHoldBaseUrlHeader,
            })
            walletSettled = true
          }
          throw error
        }

        const startedAt = Date.now()
        const stream = createUIMessageStream<UIMessage>({
          originalMessages: messages,
          execute: async ({ writer }) => {
            try {
              const pipeline = await runtimeDeps.executeChatPipeline({
                aiModel,
                messages: messages as UIMessage[],
                model,
                modelInfo,
                organizationId,
                conversationId: parsedBody.conversationId,
                requestProviderOptions: parsedBody.providerOptions,
                projectContext: parsedBody.projectContext,
                resolvedPolicy,
                enabledTools: [],
                hasLocalExecution: true,
                enableTools,
                enableWebSearch,
                orgAiSettings: null,
                apiKey: envelope.accessToken,
                exaWebSearch: undefined,
                onFinish: async (event: unknown) => {
                  const eventRecord = isRecord(event) ? event : {}
                  const usage = isRecord(eventRecord.totalUsage) ? eventRecord.totalUsage : {}
                  const inputTokenDetails = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : {}
                  const outputTokenDetails = isRecord(usage.outputTokenDetails) ? usage.outputTokenDetails : {}

                  const promptTokens = Math.max(0, Math.floor(toFiniteNumber(usage.inputTokens) ?? 0))
                  const completionTokens = Math.max(0, Math.floor(toFiniteNumber(usage.outputTokens) ?? 0))
                  const totalTokens = Math.max(
                    0,
                    Math.floor(toFiniteNumber(usage.totalTokens) ?? promptTokens + completionTokens)
                  )
                  const reasoningTokens = Math.max(
                    0,
                    Math.floor(
                      toFiniteNumber(outputTokenDetails.reasoningTokens)
                      ?? toFiniteNumber(usage.reasoningTokens)
                      ?? 0
                    )
                  )
                  const cachedInputTokens = Math.max(
                    0,
                    Math.floor(
                      toFiniteNumber(inputTokenDetails.cacheReadTokens)
                      ?? toFiniteNumber(usage.cachedInputTokens)
                      ?? 0
                    )
                  )
                  const finishReason =
                    typeof eventRecord.finishReason === 'string' ? eventRecord.finishReason : undefined
                  const rawFinishReason =
                    typeof eventRecord.rawFinishReason === 'string' ? eventRecord.rawFinishReason : undefined

                  let spendCents: number | undefined
                  let usageError: string | undefined

                  if (managedProvider && walletHoldId && walletHoldAuthorization) {
                    let pricing = this.resolvePricingFromModelInfo(modelInfo)
                    if (!pricing) {
                      try {
                        pricing = await this.lookupPricingFromRemote({
                          authorization: walletHoldAuthorization,
                          model,
                          preferredProvider: modelInfo.provider,
                          aiBaseUrlHeader: walletHoldBaseUrlHeader,
                        })
                      } catch (error) {
                        usageError = 'pricing lookup failed for wallet debit'
                        console.warn('Managed pricing lookup failed:', error)
                      }
                    }

                    const finalCents = pricing
                      ? this.calculateSpendCentsFromPricing({
                          promptTokens,
                          completionTokens,
                          cachedInputTokens,
                          pricing,
                        })
                      : 0
                    spendCents = finalCents

                    try {
                      const captureResult = await this.captureManagedWalletHold({
                        authorization: walletHoldAuthorization,
                        holdId: walletHoldId,
                        finalCents,
                        aiBaseUrlHeader: walletHoldBaseUrlHeader,
                      })
                      if (!captureResult.ok) {
                        usageError = usageError
                          ? `${usageError}; wallet capture failed: ${captureResult.reason || 'unknown'}`
                          : `wallet capture failed: ${captureResult.reason || 'unknown'}`
                        await this.releaseManagedWalletHoldSafely({
                          authorization: walletHoldAuthorization,
                          holdId: walletHoldId,
                          reason: 'wallet_capture_failed',
                          aiBaseUrlHeader: walletHoldBaseUrlHeader,
                        })
                      }
                      walletSettled = true
                    } catch (error) {
                      usageError = usageError
                        ? `${usageError}; wallet capture failed`
                        : 'wallet capture failed'
                      await this.releaseManagedWalletHoldSafely({
                        authorization: walletHoldAuthorization,
                        holdId: walletHoldId,
                        reason: 'wallet_capture_failed',
                        aiBaseUrlHeader: walletHoldBaseUrlHeader,
                      })
                      walletSettled = true
                      console.warn('Managed wallet capture failed:', error)
                    }
                  }

                  const projectId =
                    isRecord(parsedBody.projectContext) &&
                    typeof parsedBody.projectContext.slug === 'string' &&
                    parsedBody.projectContext.slug.trim().length > 0
                      ? parsedBody.projectContext.slug.trim()
                      : undefined
                  const durationMs = Date.now() - startedAt

                  if (authorization) {
                    const usageLogError = await this.logLocalUsageToRemote({
                      authorization,
                      organizationId,
                      model,
                      provider: modelInfo.provider,
                      promptTokens,
                      completionTokens,
                      totalTokens,
                      reasoningTokens: reasoningTokens || undefined,
                      cachedInputTokens: cachedInputTokens || undefined,
                      requestId,
                      conversationId: parsedBody.conversationId,
                      feature,
                      actionType:
                        typeof resolvedPolicy.agentId === 'string' && resolvedPolicy.agentId.trim().length > 0
                          ? resolvedPolicy.agentId.trim()
                          : undefined,
                      projectId,
                      durationMs,
                      finishReason,
                      rawFinishReason,
                      keySource: managedProvider ? 'organization' : 'provider_auth',
                      aiBaseUrlHeader,
                    })
                    if (usageLogError) {
                      usageError = usageError ? `${usageError}; ${usageLogError}` : usageLogError
                    }
                  }

                  writer.write({
                    type: 'data-usage',
                    data: {
                      model,
                      provider: modelInfo.provider,
                      promptTokens,
                      completionTokens,
                      totalTokens,
                      reasoningTokens: reasoningTokens || undefined,
                      cachedInputTokens: cachedInputTokens || undefined,
                      ...(spendCents !== undefined ? { spendCents } : {}),
                      keySource: managedProvider ? 'organization' : 'provider_auth',
                      runtime: 'local',
                      durationMs,
                      finishReason,
                      rawFinishReason,
                      ...(usageError ? { error: usageError } : {}),
                    },
                  })
                },
              })

              runtimeDeps.mergePipelineResultToWriter({
                result: pipeline.result,
                requestMessages: pipeline.requestMessages,
                continuationStateInput: pipeline.continuationStateInput,
                writer,
                providerHint: pipeline.providerHint,
              })
            } catch (error) {
              if (walletHoldId && !walletSettled && walletHoldAuthorization) {
                await this.releaseManagedWalletHoldSafely({
                  authorization: walletHoldAuthorization,
                  holdId: walletHoldId,
                  reason: 'chat_stream_error',
                  aiBaseUrlHeader: walletHoldBaseUrlHeader,
                })
                walletSettled = true
              }
              throw error
            }
          },
        })

        pipeUIMessageStreamToResponse({
          response: res,
          stream,
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': LOCAL_RUNTIME_ALLOWED_HEADERS,
          },
        })
      } catch (error) {
        if (walletHoldId && !walletSettled && walletHoldAuthorization) {
          await this.releaseManagedWalletHoldSafely({
            authorization: walletHoldAuthorization,
            holdId: walletHoldId,
            reason: 'local_runtime_failed',
            aiBaseUrlHeader: walletHoldBaseUrlHeader,
          })
          walletSettled = true
        }
        sendJson(res, 500, {
          error: 'local_runtime_failed',
          message: error instanceof Error ? error.message : 'Unknown local runtime error',
        })
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => resolve())
    })

    const address = this.server.address() as AddressInfo | null
    if (!address || !address.port) {
      throw new Error('Failed to resolve local AI runtime port')
    }

    this.endpoint = `http://127.0.0.1:${address.port}/chat`
  }
}
