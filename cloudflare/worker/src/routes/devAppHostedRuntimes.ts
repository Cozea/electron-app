import { getSandbox } from '@cloudflare/sandbox'

import {
  DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT,
  type DevAppContainedRuntimeState,
  type DevAppHostedRuntimeControlRequest,
  type DevAppHostedRuntimeStartRequest,
  type DevAppHostedRuntimeStartResponse,
  type DevAppRuntimeIdentity,
} from '../../../../shared/devAppContainedRuntime'
import { authorizeHostedDevAppRuntimeInConvex } from '../lib/convex'
import { verifyHostedRuntimeImage } from '../lib/devAppRuntimeImage'
import { createDevAppRegistryPullToken } from '../lib/devAppRegistry'
import { verifyDeviceAccessToken } from '../lib/jwt'
import type { CozeaDevAppSandbox } from '../durableObjects/CozeaDevAppSandbox'
import type { DeviceAccessClaims, Env } from '../types'

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const RUNTIME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const RESERVED_ENVIRONMENT_NAMES = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'TMPDIR',
  'NODE_OPTIONS',
  'NODE_PATH',
  'HOST',
  'HOSTNAME',
  'PORT',
])
const TRANSPORT_PORT = 8787
const SERVICE_PORT = 8080
const PROCESS_ID = 'cozea-devapp-runtime'
const INNER_CONTAINER_NAME = 'cozea-devapp-runtime'
const METADATA_PATH = '/workspace/cozea-hosted-runtime.json'
const STATE_MOUNT_PATH = '/workspace/cozea-organization-state'
const MAX_BODY_BYTES = 512 * 1024
const START_WAIT_MS = 6 * 60_000
const LEASE_TTL_MS = 90_000

interface HostedMetadata {
  version: 1
  releaseId: string
  imageDigest: string
  state: 'none' | 'organization'
  runtimeId: string
  transportToken: string
  transportUrl: string
  serviceUrl: string | null
  serviceToken: string | null
  startedAt: number
}

type HostedRuntimeTarget = DevAppHostedRuntimeControlRequest &
  Partial<Pick<DevAppHostedRuntimeStartRequest, 'servicePort'>>

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  )
}

function bearer(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  return authorization.slice(7).trim()
}

async function authenticated(request: Request, env: Env): Promise<DeviceAccessClaims> {
  return await verifyDeviceAccessToken(env, bearer(request))
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error('The hosted runtime request is too large')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error('The hosted runtime request is too large')
  }
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The hosted runtime request must be an object')
  }
  return parsed as Record<string, unknown>
}

function segment(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SEGMENT.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function parseControl(value: Record<string, unknown>): DevAppHostedRuntimeControlRequest {
  const runtimeId = typeof value.runtimeId === 'string' ? value.runtimeId : ''
  if (!RUNTIME_ID.test(runtimeId)) throw new Error('The hosted runtime ID is invalid')
  if (value.location !== 'hosted') throw new Error('The hosted runtime location is invalid')
  if (value.state !== 'none' && value.state !== 'organization') {
    throw new Error('The hosted runtime state scope is invalid')
  }
  const identityValue = value.identity
  if (!identityValue || typeof identityValue !== 'object' || Array.isArray(identityValue)) {
    throw new Error('The hosted runtime identity is invalid')
  }
  const identityInput = identityValue as Record<string, unknown>
  const identity: DevAppRuntimeIdentity = {
    organizationId: segment(identityInput.organizationId, 'The organization ID'),
    publicationId: segment(identityInput.publicationId, 'The publication ID'),
    releaseId: segment(identityInput.releaseId, 'The release ID'),
    releaseVersion: Number(identityInput.releaseVersion),
    contentHash: typeof identityInput.contentHash === 'string' ? identityInput.contentHash : '',
    sourceDigest: typeof identityInput.sourceDigest === 'string' ? identityInput.sourceDigest : '',
    packageManifestDigest:
      typeof identityInput.packageManifestDigest === 'string' ? identityInput.packageManifestDigest : '',
  }
  if (
    !Number.isSafeInteger(identity.releaseVersion) ||
    identity.releaseVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(identity.contentHash) ||
    !/^[a-f0-9]{64}$/.test(identity.sourceDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(identity.packageManifestDigest)
  ) {
    throw new Error('The hosted runtime identity is invalid')
  }
  return { runtimeId, identity, location: 'hosted', state: value.state }
}

function parseStart(value: Record<string, unknown>): DevAppHostedRuntimeStartRequest {
  const control = parseControl(value)
  const environmentValue = value.environment
  if (!environmentValue || typeof environmentValue !== 'object' || Array.isArray(environmentValue)) {
    throw new Error('The hosted runtime environment is invalid')
  }
  const environment: Record<string, string> = {}
  for (const [name, entry] of Object.entries(environmentValue)) {
    if (
      !ENVIRONMENT_NAME.test(name) ||
      RESERVED_ENVIRONMENT_NAMES.has(name) ||
      name.startsWith('COZEA_') ||
      typeof entry !== 'string' ||
      entry.length > 32_768 ||
      entry.includes('\0') ||
      entry.includes('\n') ||
      entry.includes('\r')
    ) {
      throw new Error('The hosted runtime environment is invalid')
    }
    environment[name] = entry
  }
  if (Object.keys(environment).length > DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT) {
    throw new Error('The hosted runtime environment is too large')
  }
  const resourcesValue = value.resources
  if (!resourcesValue || typeof resourcesValue !== 'object' || Array.isArray(resourcesValue)) {
    throw new Error('The hosted runtime resources are invalid')
  }
  const resources = resourcesValue as Record<string, unknown>
  const expectedResources = {
    cpus: 2,
    memoryBytes: 1024 * 1024 * 1024,
    rootfsBytes: 4 * 1024 * 1024 * 1024,
    writableLayerBytes: 512 * 1024 * 1024,
  }
  if (Object.entries(expectedResources).some(([name, expected]) => resources[name] !== expected)) {
    throw new Error('The hosted runtime resources are invalid')
  }
  const servicePort = value.servicePort === undefined ? undefined : Number(value.servicePort)
  if (servicePort !== undefined && servicePort !== SERVICE_PORT) {
    throw new Error('The hosted service port is invalid')
  }
  if (typeof value.network !== 'boolean') throw new Error('The hosted network policy is invalid')
  return {
    ...control,
    environment,
    ...(servicePort ? { servicePort } : {}),
    network: value.network,
    resources: expectedResources,
  }
}

function shell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sandboxId(request: DevAppHostedRuntimeControlRequest): Promise<string> {
  const scope =
    request.state === 'organization'
      ? `organization:${request.identity.organizationId}:${request.identity.publicationId}`
      : `runtime:${request.identity.organizationId}:${request.identity.publicationId}:${request.identity.releaseId}:${request.runtimeId}`
  return `devapp-${(await digest(scope)).slice(0, 48)}`
}

function sandbox(env: Env, id: string): CozeaDevAppSandbox {
  return getSandbox(env.DEVAPP_SANDBOX, id, {
    keepAlive: false,
    sleepAfter: '15m',
    enableDefaultSession: false,
    normalizeId: true,
    transport: 'rpc',
    labels: { workload: 'published-devapp' },
    containerTimeouts: {
      instanceGetTimeoutMS: 60_000,
      portReadyTimeoutMS: 180_000,
      waitIntervalMS: 500,
    },
  })
}

async function readMetadata(target: CozeaDevAppSandbox): Promise<HostedMetadata | null> {
  try {
    const file = await target.readFile(METADATA_PATH, { encoding: 'utf8' })
    const parsed = JSON.parse(file.content) as HostedMetadata
    const transport = new URL(parsed.transportUrl)
    const service = parsed.serviceUrl === null ? null : new URL(parsed.serviceUrl)
    if (
      parsed?.version !== 1 ||
      !SEGMENT.test(parsed.releaseId) ||
      !/^sha256:[a-f0-9]{64}$/.test(parsed.imageDigest) ||
      (parsed.state !== 'none' && parsed.state !== 'organization') ||
      !RUNTIME_ID.test(parsed.runtimeId) ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(parsed.transportToken) ||
      transport.protocol !== 'https:' ||
      transport.href !== transport.origin + '/' ||
      (service &&
        (service.protocol !== 'https:' ||
          service.href !== service.origin + '/' ||
          service.origin !== transport.origin)) ||
      (service === null ? parsed.serviceToken !== null : !/^[A-Za-z0-9_-]{32,256}$/.test(parsed.serviceToken ?? '')) ||
      !Number.isFinite(parsed.startedAt) ||
      parsed.startedAt <= 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function runtimeState(
  request: HostedRuntimeTarget,
  imageDigest: string,
  status: DevAppContainedRuntimeState['status'],
  metadata?: HostedMetadata,
  error: string | null = null,
): DevAppContainedRuntimeState {
  return {
    runtimeId: request.runtimeId,
    status,
    location: 'hosted',
    state: request.state,
    publicationId: request.identity.publicationId,
    releaseId: request.identity.releaseId,
    imageDigest,
    guestAddress: null,
    servicePort: request.servicePort ?? null,
    startedAt: metadata?.startedAt ?? null,
    exitedAt: status === 'stopped' || status === 'failed' ? Date.now() : null,
    exitCode: status === 'failed' ? 1 : null,
    error,
  }
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function envFile(
  request: DevAppHostedRuntimeStartRequest,
  transportToken: string,
  serviceToken: string | null,
): string {
  const values: Record<string, string> = {
    ...request.environment,
    COZEA_DEVAPP_PUBLICATION_ID: request.identity.publicationId,
    COZEA_DEVAPP_RELEASE_ID: request.identity.releaseId,
    COZEA_DEVAPP_DATA_DIR: request.state === 'organization' ? '/cozea/state' : '/tmp',
    COZEA_DEVAPP_HOSTED_TRANSPORT_SECRET: transportToken,
    COZEA_DEVAPP_HOSTED_TRANSPORT_PORT: String(TRANSPORT_PORT),
    ...(request.servicePort
      ? {
          COZEA_DEVAPP_HOSTED_SERVICE_SECRET: serviceToken!,
          COZEA_DEVAPP_HOSTED_SERVICE_PORT: String(request.servicePort),
          HOST: '0.0.0.0',
          HOSTNAME: '0.0.0.0',
          PORT: String(request.servicePort),
        }
      : {}),
  }
  return `${Object.entries(values)
    .map(([name, entry]) => `${name}=${entry}`)
    .join('\n')}\n`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function clearHostedRuntime(target: CozeaDevAppSandbox, releaseId: string, clearLeases: boolean): Promise<void> {
  await target.unexposePort(TRANSPORT_PORT).catch(() => undefined)
  const process = await target.getProcess(PROCESS_ID).catch(() => null)
  await process?.kill('SIGKILL').catch(() => undefined)
  await target
    .exec(`docker rm -f ${INNER_CONTAINER_NAME} >/dev/null 2>&1 || true`, {
      timeout: 30_000,
      origin: 'internal',
    })
    .catch(() => undefined)
  await target.unmountBucket(STATE_MOUNT_PATH).catch(() => undefined)
  await target.deleteFile('/workspace/cozea-devapp.env').catch(() => undefined)
  await target.deleteFile('/workspace/.cozea-docker/config.json').catch(() => undefined)
  await target.deleteFile(METADATA_PATH).catch(() => undefined)
  if (clearLeases) await target.clearHostedRuntimeLeases(releaseId).catch(() => undefined)
}

async function responseWithLease(
  target: CozeaDevAppSandbox,
  request: DevAppHostedRuntimeStartRequest,
  imageDigest: string,
  metadata: HostedMetadata,
): Promise<DevAppHostedRuntimeStartResponse> {
  const controlToken = randomToken()
  const acquired = await target.acquireHostedRuntimeLease(
    request.identity.releaseId,
    controlToken,
    Date.now() + LEASE_TTL_MS,
  )
  if (!acquired) throw new Error('The hosted DevApp runtime lease could not be created')
  return {
    state: runtimeState(request, imageDigest, 'running', metadata),
    transportUrl: metadata.transportUrl,
    transportToken: metadata.transportToken,
    controlToken,
    serviceUrl: metadata.serviceUrl,
    serviceToken: metadata.serviceToken,
  }
}

async function ensureHostedRuntime(
  env: Env,
  auth: DeviceAccessClaims,
  request: DevAppHostedRuntimeStartRequest,
): Promise<DevAppHostedRuntimeStartResponse> {
  const release = await authorizeHostedDevAppRuntimeInConvex(env, auth, {
    organizationId: request.identity.organizationId,
    publicationId: request.identity.publicationId,
    releaseId: request.identity.releaseId,
  })
  if (
    release.id !== request.identity.releaseId ||
    release.version !== request.identity.releaseVersion ||
    release.contentHash !== request.identity.contentHash ||
    release.runtimeSourceDigest !== request.identity.sourceDigest ||
    release.packageManifestDigest !== request.identity.packageManifestDigest ||
    release.parts.runtime?.location !== 'hosted' ||
    release.parts.runtime.state !== request.state
  ) {
    throw new Error('The hosted runtime request does not match the active release')
  }
  const hasService = release.parts.service?.runtimeKind === 'node'
  if (hasService && release.parts.service?.network !== true) {
    throw new Error('The hosted Service DevApp has no explicit network contract')
  }
  if (release.parts.worker?.capabilities.some((capability) => capability !== 'net.outbound')) {
    throw new Error("Hosted workers cannot act on a member's device")
  }
  const network =
    release.parts.service?.network === true || release.parts.worker?.capabilities.includes('net.outbound') === true
  if (network !== request.network || Boolean(request.servicePort) !== hasService) {
    throw new Error('The hosted runtime policy does not match the active release')
  }
  const image = await verifyHostedRuntimeImage(
    release.runtimeImage,
    request.identity,
    env.COZEA_RUNTIME_SIGNING_PUBLIC_KEY,
  )
  if (!/^ghcr\.io\/cozea\/devapps@sha256:[a-f0-9]{64}$/.test(image.reference)) {
    throw new Error('The hosted DevApp image repository is not authorized')
  }
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(env.DEVAPP_SANDBOX_PREVIEW_HOSTNAME)) {
    throw new Error('The hosted DevApp preview hostname is not configured')
  }
  const target = sandbox(env, await sandboxId(request))
  const reusable = async (): Promise<HostedMetadata | null> => {
    const metadata = await readMetadata(target)
    if (
      !metadata ||
      metadata.releaseId !== request.identity.releaseId ||
      metadata.imageDigest !== image.platformDigest ||
      metadata.state !== request.state ||
      Boolean(metadata.serviceUrl) !== Boolean(request.servicePort)
    ) {
      return null
    }
    if ((await target.activeHostedRuntimeLeaseCount(request.identity.releaseId)) === 0) {
      return null
    }
    const process = await target.getProcess(PROCESS_ID).catch(() => null)
    return process?.status === 'running' ? metadata : null
  }
  const existing = await reusable()
  if (existing) return await responseWithLease(target, request, image.platformDigest, existing)

  const startClaim = randomToken()
  const claimDeadline = Date.now() + START_WAIT_MS
  while (!(await target.claimHostedRuntimeStart(request.identity.releaseId, startClaim, Date.now() + START_WAIT_MS))) {
    const startedByPeer = await reusable()
    if (startedByPeer) {
      return await responseWithLease(target, request, image.platformDigest, startedByPeer)
    }
    if (Date.now() >= claimDeadline) {
      throw new Error('Timed out waiting for another hosted DevApp launch')
    }
    await delay(500)
  }

  try {
    const claimedExisting = await reusable()
    if (claimedExisting) {
      return await responseWithLease(target, request, image.platformDigest, claimedExisting)
    }

    await clearHostedRuntime(target, request.identity.releaseId, true)
    await target.setAllowedHosts(['ghcr.io', '*.githubusercontent.com', 'r2.internal'])
    if (request.state === 'organization') {
      await target.mkdir(STATE_MOUNT_PATH, { recursive: true })
      await target.mountBucket('DEVAPP_ORG_STATE', STATE_MOUNT_PATH, {
        prefix: `/organizations/${request.identity.organizationId}/publications/${request.identity.publicationId}`,
        readOnly: false,
      })
    }
    const registry = await createDevAppRegistryPullToken(env)
    const configDir = '/workspace/.cozea-docker'
    await target.mkdir(configDir, { recursive: true })
    await target.writeFile(
      `${configDir}/config.json`,
      JSON.stringify({
        auths: { 'ghcr.io': { identitytoken: registry.token } },
      }),
    )
    const repository = image.reference.slice(0, image.reference.lastIndexOf('@'))
    const exactImage = `${repository}@${image.platformDigest}`
    try {
      const pulled = await target.exec(
        `docker --config ${shell(configDir)} pull --platform linux/amd64 ${shell(exactImage)}`,
        {
          timeout: Math.min(240_000, Math.max(30_000, registry.expiresAt - Date.now())),
          origin: 'internal',
        },
      )
      if (!pulled.success) throw new Error('The signed DevApp image could not be pulled')
    } finally {
      await target.deleteFile(`${configDir}/config.json`).catch(() => undefined)
    }
    await target.setAllowedHosts(network ? ['*'] : ['r2.internal'])
    const transportToken = randomToken()
    const serviceToken = request.servicePort ? randomToken() : null
    const envPath = '/workspace/cozea-devapp.env'
    await target.writeFile(envPath, envFile(request, transportToken, serviceToken))
    const stateMount =
      request.state === 'organization' ? ` --mount type=bind,src=${shell(STATE_MOUNT_PATH)},dst=/cozea/state` : ''
    const command = [
      'docker run --rm',
      `--name ${INNER_CONTAINER_NAME}`,
      '--network host',
      '--read-only',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--pids-limit 512',
      '--memory 1024m',
      '--cpus 2',
      '--tmpfs /tmp:rw,nosuid,nodev,size=268435456',
      `--env-file ${shell(envPath)}`,
      stateMount,
      shell(exactImage),
    ]
      .filter(Boolean)
      .join(' ')
    const process = await target.startProcess(command, {
      processId: PROCESS_ID,
      autoCleanup: false,
    })
    try {
      await process.waitForPort(TRANSPORT_PORT, {
        path: '/__cozea/health',
        status: 200,
        timeout: 120_000,
        interval: 500,
      })
      if (request.servicePort) {
        await process.waitForPort(request.servicePort, {
          mode: 'tcp',
          timeout: 120_000,
          interval: 500,
        })
      }
    } catch (error) {
      await process.kill('SIGKILL').catch(() => undefined)
      const logs = await process.getLogs().catch(() => ({ stdout: '', stderr: '' }))
      const detail = `${logs.stderr}\n${logs.stdout}`.trim().slice(-2048)
      throw new Error(detail || (error instanceof Error ? error.message : 'The hosted DevApp did not become ready'))
    } finally {
      await target.deleteFile(envPath).catch(() => undefined)
    }
    const transport = await target.exposePort(TRANSPORT_PORT, {
      hostname: env.DEVAPP_SANDBOX_PREVIEW_HOSTNAME,
      name: 'runtime-transport',
    })
    const metadata: HostedMetadata = {
      version: 1,
      releaseId: request.identity.releaseId,
      imageDigest: image.platformDigest,
      state: request.state,
      runtimeId: request.runtimeId,
      transportToken,
      transportUrl: transport.url,
      serviceUrl: request.servicePort ? transport.url : null,
      serviceToken,
      startedAt: Date.now(),
    }
    await target.writeFile(METADATA_PATH, JSON.stringify(metadata))
    return await responseWithLease(target, request, image.platformDigest, metadata)
  } catch (error) {
    await clearHostedRuntime(target, request.identity.releaseId, true)
    await target.destroy().catch(() => undefined)
    throw error
  } finally {
    await target.releaseHostedRuntimeStartClaim(request.identity.releaseId, startClaim).catch(() => undefined)
  }
}

export async function handleStartHostedDevAppRuntime(request: Request, env: Env): Promise<Response> {
  let auth: DeviceAccessClaims
  let start: DevAppHostedRuntimeStartRequest
  try {
    auth = await authenticated(request, env)
    start = parseStart(await body(request))
  } catch {
    return errorResponse('The hosted DevApp runtime request is invalid', 400)
  }
  try {
    return Response.json(await ensureHostedRuntime(env, auth, start), {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'The hosted DevApp runtime failed', 503)
  }
}

export async function handleStopHostedDevAppRuntime(request: Request, env: Env): Promise<Response> {
  let start: DevAppHostedRuntimeControlRequest
  try {
    start = parseControl(await body(request))
  } catch {
    return errorResponse('The hosted DevApp runtime stop request is invalid', 400)
  }
  const target = sandbox(env, await sandboxId(start))
  try {
    const metadata = await readMetadata(target)
    const controlToken = request.headers.get('x-cozea-hosted-runtime-token') ?? ''
    const remaining = metadata ? await target.releaseHostedRuntimeLease(start.identity.releaseId, controlToken) : null
    if (!metadata || remaining === null) {
      return errorResponse('The hosted DevApp runtime stop is not authorized', 403)
    }
    if (remaining === 0) {
      await clearHostedRuntime(target, start.identity.releaseId, false)
      await target.destroy()
    }
    return Response.json(
      {
        state: runtimeState(start, '', 'stopped'),
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'The hosted runtime could not stop', 503)
  }
}

export async function handleRenewHostedDevAppRuntime(request: Request, env: Env): Promise<Response> {
  let start: DevAppHostedRuntimeControlRequest
  try {
    start = parseControl(await body(request))
  } catch {
    return errorResponse('The hosted DevApp runtime lease request is invalid', 400)
  }
  const controlToken = request.headers.get('x-cozea-hosted-runtime-token') ?? ''
  const target = sandbox(env, await sandboxId(start))
  const renewed = await target
    .renewHostedRuntimeLease(start.identity.releaseId, controlToken, Date.now() + LEASE_TTL_MS)
    .catch(() => false)
  return renewed
    ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    : errorResponse('The hosted DevApp runtime lease is not authorized', 403)
}
