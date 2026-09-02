import type { Env } from '../types'

export async function createDevAppRegistryPullToken(env: Env): Promise<{
  token: string
  expiresAt: number
}> {
  if (!env.DEVAPP_IMAGE_REGISTRY_USERNAME || !env.DEVAPP_IMAGE_REGISTRY_TOKEN) {
    throw new Error('The private DevApp image registry is unavailable')
  }
  const credentials = btoa(`${env.DEVAPP_IMAGE_REGISTRY_USERNAME}:${env.DEVAPP_IMAGE_REGISTRY_TOKEN}`)
  const response = await fetch('https://ghcr.io/token?service=ghcr.io&scope=repository%3Acozea%2Fdevapps%3Apull', {
    headers: { authorization: `Basic ${credentials}`, 'user-agent': 'Cozea-DevApp-Pull/1' },
  })
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
