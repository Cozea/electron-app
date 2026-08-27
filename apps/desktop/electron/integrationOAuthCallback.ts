interface IntegrationOAuthResult {
  success: boolean
  provider: string
  error?: string
}

interface IntegrationOAuthService<TResult extends IntegrationOAuthResult> {
  handleOAuthCallback(url: string): Promise<TResult>
}

interface IntegrationOAuthSender {
  send(channel: 'integrations:oauthSuccess' | 'integrations:oauthError', payload: unknown): void
}

interface ForwardIntegrationOAuthCallbackArgs<TResult extends IntegrationOAuthResult> {
  url: string
  integrationService: IntegrationOAuthService<TResult>
  sender?: IntegrationOAuthSender | null
}

export async function forwardIntegrationOAuthCallback<TResult extends IntegrationOAuthResult>({
  url,
  integrationService,
  sender,
}: ForwardIntegrationOAuthCallbackArgs<TResult>): Promise<TResult | null> {
  try {
    const result = await integrationService.handleOAuthCallback(url)
    if (result.success) {
      sender?.send('integrations:oauthSuccess', result)
    } else {
      sender?.send('integrations:oauthError', {
        provider: result.provider,
        error: result.error || 'OAuth failed',
      })
    }
    return result
  } catch (err) {
    console.error('[OAuth] Callback handling error:', err)
    sender?.send('integrations:oauthError', {
      provider: 'unknown',
      error: err instanceof Error ? err.message : 'OAuth callback failed',
    })
    return null
  }
}
