import React, { useRef, useState, useCallback, useEffect } from 'react'
import { injectBridgeScript } from '@/utils/previewBridge'
import { cn } from '@/lib/utils'

export type PreviewEmbedMode = 'standard' | 'credentialless'

export interface PreviewIframeProps extends React.HTMLAttributes<HTMLIFrameElement> {
  src?: string
  sandbox?: string
  name?: string
  credentialless?: string
  url?: string | null
  embedMode?: PreviewEmbedMode
  onEmbedModeChange?: (mode: PreviewEmbedMode, reason: string) => void
  shouldInjectBridge?: boolean
  onBridgeReady?: () => void
  onBridgeError?: (error: string, likelyBlocked: boolean) => void
  onIframeLoad?: () => void
  onIframeError?: () => void
  onBridgeMessage?: (event: MessageEvent) => void
  reloadToken?: number
}

export const PreviewIframe = React.forwardRef<HTMLIFrameElement, PreviewIframeProps>(
  (
    {
      url,
      embedMode = 'standard',
      onEmbedModeChange,
      shouldInjectBridge,
      onBridgeReady,
      onBridgeError,
      onIframeLoad,
      onIframeError,
      onBridgeMessage,
      reloadToken = 0,
      className,
      ...props
    },
    forwardedRef
  ) => {
    const innerRef = useRef<HTMLIFrameElement>(null)
    const setRefs = useCallback(
      (node: HTMLIFrameElement | null) => {
        innerRef.current = node
        if (typeof forwardedRef === 'function') {
          forwardedRef(node)
        } else if (forwardedRef) {
          forwardedRef.current = node
        }
      },
      [forwardedRef]
    )

    const [currentMode, setCurrentMode] = useState<PreviewEmbedMode>(embedMode)

    // Sync external mode changes
    useEffect(() => {
      setCurrentMode(embedMode)
    }, [embedMode])

    const handleLoad = useCallback(async (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      onIframeLoad?.()
      props.onLoad?.(e)

      if (!shouldInjectBridge || !innerRef.current) return

      try {
        const result = await injectBridgeScript(innerRef.current)
        if (result.success) {
          onBridgeReady?.()
        } else {
          const reason = result.reason || 'bridge_injection_failed'
          const isBlocked = result.likelyBlocked || reason === 'blocked_response' || reason === 'chrome_error_document'

          if (currentMode === 'standard' && isBlocked) {
            setCurrentMode('credentialless')
            onEmbedModeChange?.('credentialless', reason)
            return
          }

          onBridgeError?.(result.error || 'Failed to inject bridge', isBlocked)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (currentMode === 'standard') {
          setCurrentMode('credentialless')
          onEmbedModeChange?.('credentialless', 'injection_error')
          return
        }
        onBridgeError?.(msg, true)
      }
    }, [shouldInjectBridge, currentMode, onIframeLoad, onBridgeReady, onBridgeError, onEmbedModeChange, props.onLoad])

    const handleError = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
      onIframeError?.()
      props.onError?.(e)
    }, [onIframeError, props.onError])

    const credentiallessAttribute = currentMode === 'credentialless' ? '' : undefined

    useEffect(() => {
      if (!onBridgeMessage) return
      
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== innerRef.current?.contentWindow) return
        onBridgeMessage(event)
      }
      
      window.addEventListener('message', handleMessage)
      return () => window.removeEventListener('message', handleMessage)
    }, [onBridgeMessage])

    if (!url) {
      return null
    }

    return (
      <iframe
        ref={setRefs}
        key={`${url}-${currentMode}-${reloadToken}`}
        src={url}
        credentialless={credentiallessAttribute}
        onLoad={handleLoad}
        onError={handleError}
        className={cn("border-none", className)}
        {...props}
      />
    )
  }
)

PreviewIframe.displayName = 'PreviewIframe'
