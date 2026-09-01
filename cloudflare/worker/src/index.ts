import type { Env } from './types'
import { ContainerProxy, proxyToSandbox } from '@cloudflare/sandbox'
import { handleHealth } from './routes/health'
import { handleCollabCapabilities } from './routes/collabCapabilities'
import { handleCollabSession } from './routes/collabSession'
import { preflightResponse, protocolError } from './lib/protocol'
import { CollabRoom } from './durableObjects/CollabRoom'
import { DevAppRuntimeBuild } from './durableObjects/DevAppRuntimeBuild'
import { CozeaDevAppSandbox } from './durableObjects/CozeaDevAppSandbox'
import {
  handleCompleteDevAppRuntimeBuild,
  handleCreateDevAppRuntimeBuild,
  handleGetDevAppRuntimeBuild,
  handleGetDevAppRuntimeBuildSource,
} from './routes/devAppRuntimeBuilds'
import { handleCreateDevAppRuntimePull } from './routes/devAppRuntimePull'
import {
  handleRenewHostedDevAppRuntime,
  handleStartHostedDevAppRuntime,
  handleStopHostedDevAppRuntime,
} from './routes/devAppHostedRuntimes'
import { handleDeviceAuthChallenge, handleDeviceAuthComplete, handleDeviceAuthJwks } from './routes/deviceAuth'
import { handleCreateRecoveryGrant, handleRedeemRecoveryGrant } from './routes/deviceRecovery'

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  const id = env.COLLAB_ROOM.idFromName(roomId)
  return env.COLLAB_ROOM.get(id)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin')
    try {
      const sandboxProxy = await proxyToSandbox(request, { Sandbox: env.DEVAPP_SANDBOX })
      if (sandboxProxy) return sandboxProxy
      const url = new URL(request.url)

      if (request.method === 'OPTIONS') {
        return preflightResponse(origin)
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return handleHealth(origin)
      }

      if (request.method === 'GET' && url.pathname === '/collab/capabilities') {
        return handleCollabCapabilities(env)
      }

      if (request.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
        return handleDeviceAuthJwks(env)
      }

      if (request.method === 'POST' && url.pathname === '/auth/device/challenge') {
        try {
          return await handleDeviceAuthChallenge(request, env)
        } catch (error) {
          return protocolError(
            'DEVICE_AUTH_CHALLENGE_REJECTED',
            error instanceof Error ? error.message : 'Invalid device challenge request',
            { status: 400 },
            false,
            origin,
          )
        }
      }

      if (request.method === 'POST' && url.pathname === '/auth/device/complete') {
        try {
          return await handleDeviceAuthComplete(request, env)
        } catch (error) {
          return protocolError(
            'DEVICE_AUTH_REJECTED',
            error instanceof Error ? error.message : 'Device authentication failed',
            { status: 401 },
            false,
            origin,
          )
        }
      }

      if (request.method === 'POST' && url.pathname === '/auth/device/recovery/create') {
        try {
          return await handleCreateRecoveryGrant(request, env)
        } catch (error) {
          return protocolError(
            'RECOVERY_GRANT_REJECTED',
            error instanceof Error ? error.message : 'Recovery grant failed',
            { status: 403 },
            false,
            origin,
          )
        }
      }

      if (request.method === 'POST' && url.pathname === '/auth/device/recovery/redeem') {
        try {
          return await handleRedeemRecoveryGrant(request, env)
        } catch (error) {
          return protocolError(
            'RECOVERY_REJECTED',
            error instanceof Error ? error.message : 'Recovery failed',
            { status: 403 },
            false,
            origin,
          )
        }
      }

      if (request.method === 'POST' && url.pathname === '/collab/session') {
        try {
          return await handleCollabSession(request, env)
        } catch (error) {
          return protocolError(
            'BAD_REQUEST',
            error instanceof Error ? error.message : 'Invalid collaboration session request',
            { status: 400 },
            false,
            origin,
          )
        }
      }

      if (request.method === 'POST' && url.pathname === '/devapps/runtime-builds') {
        return await handleCreateDevAppRuntimeBuild(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/devapps/runtime-pulls') {
        return await handleCreateDevAppRuntimePull(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/devapps/hosted-runtimes/start') {
        return await handleStartHostedDevAppRuntime(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/devapps/hosted-runtimes/stop') {
        return await handleStopHostedDevAppRuntime(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/devapps/hosted-runtimes/renew') {
        return await handleRenewHostedDevAppRuntime(request, env)
      }

      const runtimeBuildMatch = url.pathname.match(/^\/devapps\/runtime-builds\/([A-Za-z0-9_-]+)$/)
      if (request.method === 'GET' && runtimeBuildMatch) {
        return await handleGetDevAppRuntimeBuild(request, env, runtimeBuildMatch[1])
      }

      const internalSourceMatch = url.pathname.match(/^\/internal\/devapps\/runtime-builds\/([A-Za-z0-9_-]+)\/source$/)
      if (request.method === 'GET' && internalSourceMatch) {
        return await handleGetDevAppRuntimeBuildSource(request, env, internalSourceMatch[1])
      }

      const internalCompleteMatch = url.pathname.match(
        /^\/internal\/devapps\/runtime-builds\/([A-Za-z0-9_-]+)\/complete$/,
      )
      if (request.method === 'POST' && internalCompleteMatch) {
        return await handleCompleteDevAppRuntimeBuild(request, env, internalCompleteMatch[1])
      }

      if (url.pathname === '/collab/ws') {
        const roomId = url.searchParams.get('roomId')
        if (!roomId) {
          return protocolError('BAD_REQUEST', 'roomId query parameter is required', { status: 400 }, false, origin)
        }
        const stub = getRoomStub(env, roomId)
        return stub.fetch(request)
      }

      return protocolError('NOT_FOUND', 'Route not found', { status: 404 }, false, origin)
    } catch (error) {
      return protocolError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unexpected worker error',
        { status: 500 },
        false,
        origin,
      )
    }
  },
} satisfies ExportedHandler<Env>

export { CollabRoom, CozeaDevAppSandbox, ContainerProxy, DevAppRuntimeBuild }
