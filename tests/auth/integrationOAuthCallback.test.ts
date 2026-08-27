import { afterEach, describe, expect, it, vi } from 'vitest'

import { forwardIntegrationOAuthCallback } from '../../apps/desktop/electron/integrationOAuthCallback'

describe('integration OAuth callback forwarding', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the integration service exactly once and forwards successful results', async () => {
    const result = {
      success: true,
      provider: 'github',
      accessToken: 'token_123',
    }
    const handleOAuthCallback = vi.fn().mockResolvedValue(result)
    const send = vi.fn()

    await forwardIntegrationOAuthCallback({
      url: 'cozea://oauth/callback?code=abc&state=123',
      integrationService: { handleOAuthCallback },
      sender: { send },
    })

    expect(handleOAuthCallback).toHaveBeenCalledTimes(1)
    expect(handleOAuthCallback).toHaveBeenCalledWith('cozea://oauth/callback?code=abc&state=123')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('integrations:oauthSuccess', result)
  })

  it('forwards unsuccessful OAuth results as renderer errors', async () => {
    const handleOAuthCallback = vi.fn().mockResolvedValue({
      success: false,
      provider: 'vercel',
      error: 'Access denied',
    })
    const send = vi.fn()

    await forwardIntegrationOAuthCallback({
      url: 'cozea://oauth/callback?error=access_denied',
      integrationService: { handleOAuthCallback },
      sender: { send },
    })

    expect(handleOAuthCallback).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('integrations:oauthError', {
      provider: 'vercel',
      error: 'Access denied',
    })
  })

  it('converts thrown callback failures into unknown-provider renderer errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handleOAuthCallback = vi.fn().mockRejectedValue(new Error('Token exchange failed'))
    const send = vi.fn()

    const forwarded = await forwardIntegrationOAuthCallback({
      url: 'cozea://oauth/callback?code=abc&state=123',
      integrationService: { handleOAuthCallback },
      sender: { send },
    })

    expect(forwarded).toBeNull()
    expect(handleOAuthCallback).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('integrations:oauthError', {
      provider: 'unknown',
      error: 'Token exchange failed',
    })
  })
})
