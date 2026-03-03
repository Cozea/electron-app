import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain } from 'electron'
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

type LocalAiRuntimeProvider = 'openai' | 'google'

interface ProviderAuthEnvelope {
  provider: LocalAiRuntimeProvider
  accessToken: string
}

interface ChatRequestBody {
  messages: unknown[]
  model: string
  organizationId: string
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
  capabilities?: Record<string, unknown>
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
  return envFlagEnabled(process.env.AI_LOCAL_RUNTIME_ENABLED)
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cozea-provider-auth')
  res.end(body)
}

function parseProviderAuthEnvelope(encodedHeader: string | undefined): ProviderAuthEnvelope | null {
  if (!encodedHeader) return null
  try {
    const decoded = Buffer.from(encodedHeader, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as ProviderAuthEnvelope
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.provider !== 'openai' && parsed.provider !== 'google') return null
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

export class LocalAiRuntimeService {
  private static instance: LocalAiRuntimeService | null = null

  private server: ReturnType<typeof createServer> | null = null
  private endpoint: string | null = null
  private runtimeDeps: LocalRuntimeDeps | null = null

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

  private async ensureServer(runtimeDeps: LocalRuntimeDeps): Promise<void> {
    if (this.server && this.endpoint) return

    this.server = createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cozea-provider-auth')
        res.end()
        return
      }

      if (req.method !== 'POST' || req.url !== '/chat') {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

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
        const organizationId = parsedBody.organizationId
        const enableTools = parsedBody.enableTools ?? true
        const enableWebSearch = parsedBody.enableWebSearch ?? false

        const modelInfo = runtimeDeps.getModelInfo(model)
        if (!modelInfo || (modelInfo.provider !== 'openai' && modelInfo.provider !== 'google')) {
          sendJson(res, 400, { error: 'Unsupported model for local runtime' })
          return
        }

        const headerValue = req.headers['x-cozea-provider-auth']
        const encodedEnvelope = Array.isArray(headerValue) ? headerValue[0] : headerValue
        const envelope = parseProviderAuthEnvelope(encodedEnvelope)
        if (!envelope || envelope.provider !== modelInfo.provider) {
          sendJson(res, 402, {
            error: 'provider_auth_required',
            message: 'Provider auth envelope is missing, invalid, or for the wrong provider.',
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

        const aiModel = runtimeDeps.createProviderModelFromEnvelope(
          modelInfo.provider as LocalAiRuntimeProvider,
          modelInfo.providerModelId,
          envelope
        )

        const startedAt = Date.now()
        const stream = createUIMessageStream<UIMessage>({
          originalMessages: messages,
          execute: async ({ writer }) => {
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
              enableTools,
              enableWebSearch,
              orgAiSettings: null,
              apiKey: envelope.accessToken,
              exaWebSearch: undefined,
              onFinish: async (event: any) => {
                const usage = event.totalUsage
                const promptTokens = usage.inputTokens ?? 0
                const completionTokens = usage.outputTokens ?? 0
                const totalTokens = usage.totalTokens ?? promptTokens + completionTokens

                writer.write({
                  type: 'data-usage',
                  data: {
                    model,
                    provider: modelInfo.provider,
                    promptTokens,
                    completionTokens,
                    totalTokens,
                    keySource: 'provider_auth',
                    runtime: 'local',
                    durationMs: Date.now() - startedAt,
                    finishReason: event.finishReason,
                    rawFinishReason: event.rawFinishReason,
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
          },
        })

        pipeUIMessageStreamToResponse({
          response: res,
          stream,
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-cozea-provider-auth',
          },
        })
      } catch (error) {
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
