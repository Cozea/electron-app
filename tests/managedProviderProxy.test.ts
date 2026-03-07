import { afterEach, describe, expect, it } from 'vitest'

import {
  buildManagedProviderEnvelope,
  verifyManagedProviderProxyToken,
} from '../server/src/routes/ai/managedProviders'

const ORIGINAL_PROXY_SECRET = process.env.COZEA_MANAGED_PROVIDER_PROXY_SECRET
const ORIGINAL_OPENAI_KEY = process.env.COZEA_OPENAI_API_KEY
const ORIGINAL_GOOGLE_KEY = process.env.COZEA_GOOGLE_API_KEY

afterEach(() => {
  process.env.COZEA_MANAGED_PROVIDER_PROXY_SECRET = ORIGINAL_PROXY_SECRET
  process.env.COZEA_OPENAI_API_KEY = ORIGINAL_OPENAI_KEY
  process.env.COZEA_GOOGLE_API_KEY = ORIGINAL_GOOGLE_KEY
})

describe('managed provider proxy envelopes', () => {
  it('mints a short-lived proxy token instead of returning the raw OpenAI key', () => {
    process.env.COZEA_MANAGED_PROVIDER_PROXY_SECRET = 'proxy-secret'
    process.env.COZEA_OPENAI_API_KEY = 'sk-live-managed-openai'

    const envelope = buildManagedProviderEnvelope({
      providerId: 'openai',
      proxyBaseUrl: 'https://example.com/ai/provider-proxy/openai/v1',
    })

    expect(envelope).not.toBeNull()
    expect(envelope?.provider).toBe('openai')
    expect(envelope?.authType).toBe('api_key')
    expect(envelope?.baseUrl).toBe('https://example.com/ai/provider-proxy/openai/v1')
    expect(envelope?.accessToken).not.toBe('sk-live-managed-openai')

    const verified = verifyManagedProviderProxyToken({
      token: envelope?.accessToken || '',
      expectedProviderId: 'openai',
    })
    expect(verified?.providerId).toBe('openai')
    expect(typeof verified?.expiresAt).toBe('number')
  })

  it('normalizes google managed envelopes for the proxy path', () => {
    process.env.COZEA_MANAGED_PROVIDER_PROXY_SECRET = 'proxy-secret'
    process.env.COZEA_GOOGLE_API_KEY = 'google-managed-key'

    const envelope = buildManagedProviderEnvelope({
      providerId: 'google',
      proxyBaseUrl: 'https://example.com/ai/provider-proxy/google',
    })

    expect(envelope).not.toBeNull()
    expect(envelope?.provider).toBe('google')
    expect(envelope?.google?.mode).toBe('gemini')
    expect(envelope?.baseUrl).toBe('https://example.com/ai/provider-proxy/google')

    const wrongProvider = verifyManagedProviderProxyToken({
      token: envelope?.accessToken || '',
      expectedProviderId: 'anthropic',
    })
    expect(wrongProvider).toBeNull()
  })
})
