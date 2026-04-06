interface SourceControlOAuthResult {
  success: boolean
  provider: string
  error?: string
}

interface SourceControlOAuthService<TResult extends SourceControlOAuthResult> {
  handleOAuthCallback(url: string): Promise<TResult>
}

interface SourceControlOAuthSender {
  send(channel: 'sourceControl:oauthSuccess' | 'sourceControl:oauthError', payload: unknown): void
}

interface ForwardSourceControlOAuthCallbackArgs<TResult extends SourceControlOAuthResult> {
  url: string
  sourceControlService: SourceControlOAuthService<TResult>
  sender?: SourceControlOAuthSender | null
}

export async function forwardSourceControlOAuthCallback<TResult extends SourceControlOAuthResult>({
  url,
  sourceControlService,
  sender,
}: ForwardSourceControlOAuthCallbackArgs<TResult>): Promise<TResult | null> {
  try {
    const result = await sourceControlService.handleOAuthCallback(url)
    if (result.success) {
      sender?.send('sourceControl:oauthSuccess', result)
    } else {
      sender?.send('sourceControl:oauthError', {
        provider: result.provider,
        error: result.error || 'OAuth failed',
      })
    }
    return result
  } catch (error) {
    console.error('[SourceControl OAuth] Callback handling error:', error)
    sender?.send('sourceControl:oauthError', {
      provider: 'unknown',
      error: error instanceof Error ? error.message : 'OAuth callback failed',
    })
    return null
  }
}
