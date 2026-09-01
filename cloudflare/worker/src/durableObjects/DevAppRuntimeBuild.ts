import type { DevAppRuntimeBuildDescriptor } from '../../../../shared/devAppContainedRuntime'
import type { Env } from '../types'

interface StoredBuild extends DevAppRuntimeBuildDescriptor {
  identityKey: string
  sourceObjectKey: string
}

const STATE_KEY = 'build'

function publicDescriptor(build: StoredBuild): DevAppRuntimeBuildDescriptor {
  const { identityKey: _identityKey, sourceObjectKey: _sourceObjectKey, ...descriptor } = build
  return descriptor
}

export class DevAppRuntimeBuild implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const stored = await this.state.storage.get<StoredBuild>(STATE_KEY)
    if (request.method === 'POST' && url.pathname === '/initialize') {
      if (stored) return new Response('Build already exists', { status: 409 })
      const build = await request.json() as StoredBuild
      await this.state.storage.put(STATE_KEY, build)
      return Response.json(publicDescriptor(build))
    }
    if (!stored) return new Response('Build not found', { status: 404 })
    if (request.method === 'GET' && url.pathname === '/status') {
      if (request.headers.get('x-cozea-identity-key') !== stored.identityKey) {
        return new Response('Forbidden', { status: 403 })
      }
      return Response.json(publicDescriptor(stored))
    }
    if (request.method === 'GET' && url.pathname === '/internal') {
      return Response.json(stored)
    }
    if (request.method === 'POST' && url.pathname === '/transition') {
      const update = await request.json() as {
        status: StoredBuild['status']
        error?: string
        updatedAt: number
      }
      const next: StoredBuild = {
        ...stored,
        status: update.status,
        updatedAt: update.updatedAt,
        ...(update.error ? { error: update.error.slice(0, 1_000) } : {}),
      }
      await this.state.storage.put(STATE_KEY, next)
      return Response.json(publicDescriptor(next))
    }
    return new Response('Not found', { status: 404 })
  }
}
