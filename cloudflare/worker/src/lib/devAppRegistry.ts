import type { Env } from '../types'

const IMAGE_REGISTRY_HOST = 'ghcr.io'
const IMAGE_REPOSITORY_ROOT = 'cozea/devapps'
const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Repository path for an organization's DevApp images, without the registry host.
 *
 * Every organization used to publish into one shared repository, which meant a pull
 * token could only ever be scoped to all of them at once. Giving each organization
 * its own path lets a token grant exactly the release the caller was authorized for.
 * Registry paths are lowercase.
 */
export function devAppImageRepositoryPath(organizationId: string): string {
  if (!ORGANIZATION_ID.test(organizationId)) {
    throw new Error('The DevApp image organization is invalid')
  }
  return `${IMAGE_REPOSITORY_ROOT}/${organizationId.toLowerCase()}`
}

/** Fully qualified repository the builder pushes to and releases are referenced by. */
export function devAppImageRepository(organizationId: string): string {
  return `${IMAGE_REGISTRY_HOST}/${devAppImageRepositoryPath(organizationId)}`
}

export async function createDevAppRegistryPullToken(
  env: Env,
  organizationId: string,
): Promise<{
  token: string
  expiresAt: number
}> {
  if (!env.DEVAPP_IMAGE_REGISTRY_USERNAME || !env.DEVAPP_IMAGE_REGISTRY_TOKEN) {
    throw new Error('The private DevApp image registry is unavailable')
  }
  const scope = `repository:${devAppImageRepositoryPath(organizationId)}:pull`
  const credentials = btoa(`${env.DEVAPP_IMAGE_REGISTRY_USERNAME}:${env.DEVAPP_IMAGE_REGISTRY_TOKEN}`)
  const response = await fetch(
    `https://${IMAGE_REGISTRY_HOST}/token?service=${IMAGE_REGISTRY_HOST}&scope=${encodeURIComponent(scope)}`,
    {
      headers: { authorization: `Basic ${credentials}`, 'user-agent': 'Cozea-DevApp-Pull/1' },
    },
  )
  if (!response.ok) throw new Error(`The private image registry rejected access (${response.status})`)
  const body = (await response.json()) as { token?: unknown; expires_in?: unknown }
  if (typeof body.token !== 'string' || !body.token || body.token.length > 16_384) {
    throw new Error('The private image registry returned an invalid token')
  }
  const lifetimeSeconds = typeof body.expires_in === 'number' ? Math.max(1, Math.min(body.expires_in, 600)) : 300
  return {
    token: body.token,
    expiresAt: Date.now() + Math.max(1, lifetimeSeconds - 15) * 1_000,
  }
}
