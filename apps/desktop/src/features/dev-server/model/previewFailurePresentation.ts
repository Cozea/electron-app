import type { PreviewFailureReason } from '@shared/electronApiTypes'

type PreviewFailureContext = 'preview' | 'server'

interface PreviewFailurePresentationOptions {
  blocked?: boolean
  context?: PreviewFailureContext
}

export interface PreviewFailurePresentation {
  reason: PreviewFailureReason
  blocked: boolean
  title: string
  message: string
}

const NETWORK_CHANGED_PATTERN = /err_network_changed/i

function resolveNormalizedReason(
  reason: PreviewFailureReason | null | undefined,
  message: string | null | undefined,
): PreviewFailureReason {
  if (reason === 'network_quality_degraded') return reason
  if (NETWORK_CHANGED_PATTERN.test(message ?? '')) return 'network_quality_degraded'
  return reason ?? 'unknown'
}

function getNetworkQualityMessage(context: PreviewFailureContext): string {
  if (context === 'server') {
    return 'Internet connection quality degraded while checking the preview server. The network changed during the request. Check your connection and retry.'
  }

  return 'Internet connection quality degraded while loading the preview. The network changed during the request. Check your connection and retry.'
}

function getDefaultTitle(reason: PreviewFailureReason, blocked: boolean): string {
  if (reason === 'network_quality_degraded') return 'Internet connection degraded'
  if (blocked) return 'Embedded preview unavailable'
  if (reason === 'server_unreachable') return 'Preview unavailable'
  return 'Preview error'
}

function getDefaultMessage(reason: PreviewFailureReason, blocked: boolean): string {
  if (blocked) {
    return 'Embedded preview is unavailable. Retry or open it externally.'
  }

  switch (reason) {
    case 'server_unreachable':
      return 'Preview server is unreachable. Check the server and retry.'
    case 'bridge_injection_failed':
      return 'Preview bridge injection failed. Retry the preview and try again.'
    case 'bridge_timeout':
      return 'Preview bridge handshake timed out. Retry the preview and try again.'
    case 'invalid_url':
      return 'Preview URL is invalid.'
    case 'unsupported_origin':
      return 'Only localhost preview URLs are supported.'
    case 'window_unavailable':
      return 'Preview window is unavailable.'
    default:
      return 'Preview failed unexpectedly. Retry and try again.'
  }
}

export function isNetworkQualityDegradedFailure(
  reason: PreviewFailureReason | null | undefined,
  message: string | null | undefined,
): boolean {
  return resolveNormalizedReason(reason, message) === 'network_quality_degraded'
}

export function getPreviewFailurePresentation(
  reason: PreviewFailureReason | null | undefined,
  message: string | null | undefined,
  options: PreviewFailurePresentationOptions = {},
): PreviewFailurePresentation {
  const normalizedReason = resolveNormalizedReason(reason, message)
  const context = options.context ?? 'preview'

  if (normalizedReason === 'network_quality_degraded') {
    return {
      reason: normalizedReason,
      blocked: false,
      title: 'Internet connection degraded',
      message: getNetworkQualityMessage(context),
    }
  }

  const blocked =
    options.blocked ?? (
      normalizedReason === 'blocked_response' ||
      normalizedReason === 'chrome_error_document' ||
      normalizedReason === 'bridge_timeout' ||
      normalizedReason === 'iframe_load_error'
    )

  const trimmedMessage = message?.trim()

  return {
    reason: normalizedReason,
    blocked,
    title: getDefaultTitle(normalizedReason, blocked),
    message: trimmedMessage && trimmedMessage.length > 0
      ? trimmedMessage
      : getDefaultMessage(normalizedReason, blocked),
  }
}
