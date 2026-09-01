import type {
  DevAppRuntimeBuildDescriptor,
  DevAppRuntimeReleaseImage,
} from '../../../../shared/devAppContainedRuntime'
import type { DevAppParts } from '../../../../shared/devAppParts'
import {
  authorizeDevAppRuntimeBuildInConvex,
  completeDevAppRuntimeBuildInConvex,
  registerDevAppRuntimeBuildInConvex,
  requireActiveDeviceAccessInConvex,
} from '../lib/convex'
import { verifyDeviceAccessToken } from '../lib/jwt'
import type { DeviceAccessClaims, Env } from '../types'

const MAX_SOURCE_BYTES = 128 * 1024 * 1024
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const SOURCE_DIGEST = /^[a-f0-9]{64}$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function buildStub(env: Env, buildId: string): DurableObjectStub {
  return env.DEVAPP_RUNTIME_BUILD.get(env.DEVAPP_RUNTIME_BUILD.idFromName(buildId))
}

function bearer(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  return authorization.slice(7).trim()
}

function segment(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim() ?? ''
  if (!SEGMENT.test(value)) throw new Error(`${name} is invalid`)
  return value
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

async function authenticatedDevice(request: Request, env: Env): Promise<DeviceAccessClaims> {
  const auth = await verifyDeviceAccessToken(env, bearer(request))
  await requireActiveDeviceAccessInConvex(env, auth)
  return auth
}

async function dispatchBuild(env: Env, buildId: string): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.DEVAPP_BUILDER_GITHUB_REPOSITORY)) {
    throw new Error('The trusted DevApp builder repository is invalid')
  }
  const response = await fetch(
    `https://api.github.com/repos/${env.DEVAPP_BUILDER_GITHUB_REPOSITORY}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.DEVAPP_BUILDER_GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'Cozea-DevApp-Builder/1',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'devapp-image-build', client_payload: { buildId } }),
    },
  )
  if (!response.ok) throw new Error(`The trusted builder rejected dispatch (${response.status})`)
}

export async function handleCreateDevAppRuntimeBuild(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticatedDevice(request, env)
  if (request.headers.get('content-type') !== 'application/zip' || !request.body) {
    throw new Error('The DevApp build source must be a zip stream')
  }
  const length = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_SOURCE_BYTES) {
    throw new Error('The DevApp build source size is invalid')
  }
  const projectId = segment(request, 'x-cozea-project-id')
  const reservationId = segment(request, 'x-cozea-upload-reservation-id')
  const sourceDigest = request.headers.get('x-cozea-source-digest')?.trim() ?? ''
  const packageManifestDigest =
    request.headers.get('x-cozea-package-manifest-digest')?.trim() ?? ''
  if (!SOURCE_DIGEST.test(sourceDigest) || !SHA256_DIGEST.test(packageManifestDigest)) {
    throw new Error('The DevApp build source identity is invalid')
  }
  await authorizeDevAppRuntimeBuildInConvex(env, auth, { projectId, reservationId })

  const buildId = crypto.randomUUID()
  const sourceObjectKey = `runtime-builds/${buildId}/source.zip`
  const now = Date.now()
  const descriptor: DevAppRuntimeBuildDescriptor = {
    buildId,
    projectId,
    uploadReservationId: reservationId,
    sourceDigest,
    packageManifestDigest,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  }
  await env.DEVAPP_BUILD_INPUTS.put(sourceObjectKey, request.body, {
    sha256: hexBytes(sourceDigest),
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { buildId, projectId, reservationId, sourceDigest, packageManifestDigest },
  })
  try {
    await registerDevAppRuntimeBuildInConvex(env, {
      identityKey: auth.sub,
      projectId,
      reservationId,
      buildId,
      sourceDigest,
      packageManifestDigest,
    })
    const stub = buildStub(env, buildId)
    const initialized = await stub.fetch(new Request('https://build/initialize', {
      method: 'POST',
      body: JSON.stringify({ ...descriptor, identityKey: auth.sub, sourceObjectKey }),
    }))
    if (!initialized.ok) throw new Error('The DevApp build coordinator rejected initialization')
    await dispatchBuild(env, buildId)
    return Response.json(descriptor, { status: 202 })
  } catch (error) {
    await env.DEVAPP_BUILD_INPUTS.delete(sourceObjectKey)
    throw error
  }
}

export async function handleGetDevAppRuntimeBuild(
  request: Request,
  env: Env,
  buildId: string,
): Promise<Response> {
  if (!SEGMENT.test(buildId)) return new Response('Build not found', { status: 404 })
  const auth = await authenticatedDevice(request, env)
  return await buildStub(env, buildId).fetch(new Request('https://build/status', {
    headers: { 'x-cozea-identity-key': auth.sub },
  }))
}

function assertBuilder(request: Request, env: Env): void {
  const authorization = request.headers.get('authorization')
  if (
    !env.DEVAPP_BUILDER_CALLBACK_TOKEN ||
    authorization !== `Bearer ${env.DEVAPP_BUILDER_CALLBACK_TOKEN}`
  ) {
    throw new Error('Trusted builder authentication failed')
  }
}

export async function handleGetDevAppRuntimeBuildSource(
  request: Request,
  env: Env,
  buildId: string,
): Promise<Response> {
  assertBuilder(request, env)
  const internal = await buildStub(env, buildId).fetch(new Request('https://build/internal'))
  if (!internal.ok) return internal
  const build = await internal.json() as {
    sourceObjectKey: string
    sourceDigest: string
    packageManifestDigest: string
  }
  const source = await env.DEVAPP_BUILD_INPUTS.get(build.sourceObjectKey)
  if (!source) return new Response('Build source not found', { status: 404 })
  return new Response(source.body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(source.size),
      'x-cozea-source-digest': build.sourceDigest,
      'x-cozea-package-manifest-digest': build.packageManifestDigest,
    },
  })
}

export async function handleCompleteDevAppRuntimeBuild(
  request: Request,
  env: Env,
  buildId: string,
): Promise<Response> {
  assertBuilder(request, env)
  const body = await request.json() as {
    status?: 'building' | 'ready' | 'failed'
    runtimeImage?: DevAppRuntimeReleaseImage
    runtimeParts?: DevAppParts
    error?: string
  }
  if (!body.status || !['building', 'ready', 'failed'].includes(body.status)) {
    throw new Error('The trusted builder transition is invalid')
  }
  await completeDevAppRuntimeBuildInConvex(env, {
    buildId,
    status: body.status,
    ...(body.runtimeImage ? { runtimeImage: body.runtimeImage } : {}),
    ...(body.runtimeParts ? { runtimeParts: body.runtimeParts } : {}),
    ...(body.error ? { error: body.error.slice(0, 1_000) } : {}),
  })
  const transitioned = await buildStub(env, buildId).fetch(new Request('https://build/transition', {
    method: 'POST',
    body: JSON.stringify({ status: body.status, error: body.error, updatedAt: Date.now() }),
  }))
  if (body.status === 'ready' || body.status === 'failed') {
    const internal = await buildStub(env, buildId).fetch(new Request('https://build/internal'))
    if (internal.ok) {
      const build = await internal.json() as { sourceObjectKey: string }
      await env.DEVAPP_BUILD_INPUTS.delete(build.sourceObjectKey)
    }
  }
  return transitioned
}
