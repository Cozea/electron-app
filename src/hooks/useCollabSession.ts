import { useCallback, useEffect, useMemo, useState } from 'react'

const COLLAB_SESSION_INVALIDATION_EVENT = 'cozea:collab-session-invalidate'

interface CollabCapabilities {
  execution: 'browser-local' | 'vm'
  languageScope: string[]
  preview: boolean
  terminal: boolean
  deployments: boolean
  yjs: boolean
}

export interface CollabEncryptionBootstrap {
  roomId: string
  encryptionRequired: boolean
  status: 'room_not_initialized' | 'ready' | 'missing_for_device' | 'device_revoked'
  activeKeyVersion: number | null
  wrappedRoomKey: string | null
  wrapAlgorithm: string | null
  senderPublicKeyJwk: string | null
}

export interface CollabSession {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  deviceId: string
  deviceLabel?: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string
  capabilities: CollabCapabilities
  encryption: CollabEncryptionBootstrap
}

interface UseCollabSessionOptions {
  projectId: string | null
  enabled?: boolean
}

interface UseCollabSessionResult {
  status: 'idle' | 'loading' | 'ready' | 'error'
  session: CollabSession | null
  capabilities: CollabCapabilities | null
  error: string | null
  refresh: () => Promise<CollabSession | null>
}

export function invalidateCollabSession(projectId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent(COLLAB_SESSION_INVALIDATION_EVENT, {
      detail: { projectId },
    }),
  )
}

function normalizeGatewayBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}

function getPayloadError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const data = payload as Record<string, unknown>
  if (typeof data.error === 'string' && data.error.trim().length > 0) return data.error
  if (typeof data.message === 'string' && data.message.trim().length > 0) return data.message
  return fallback
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function useCollabSession({
  projectId,
  enabled = true,
}: UseCollabSessionOptions): UseCollabSessionResult {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [session, setSession] = useState<CollabSession | null>(null)
  const [capabilities, setCapabilities] = useState<CollabCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)

  const gatewayBaseUrl = useMemo(
    () =>
      normalizeGatewayBaseUrl(import.meta.env.VITE_COLLAB_BASE_URL) ??
      normalizeGatewayBaseUrl(import.meta.env.VITE_AUTH_SERVER_URL),
    []
  )

  const refresh = useCallback(async () => {
    if (!enabled || !projectId) {
      setStatus('idle')
      setSession(null)
      setCapabilities(null)
      setError(null)
      return null
    }

    if (!gatewayBaseUrl) {
      setStatus('error')
      setError('WebSocket collaboration gateway is not configured')
      setSession(null)
      setCapabilities(null)
      return null
    }

    setStatus('loading')
    setError(null)

    try {
      const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity()

      const sessionResponse = await fetch(`${gatewayBaseUrl}/collab/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          clientType: 'electron',
          deviceId: deviceIdentity.deviceId,
          deviceLabel: deviceIdentity.deviceLabel,
          platform: deviceIdentity.platform,
          publicKeyJwk: deviceIdentity.publicKeyJwk,
          publicKeyAlgorithm: deviceIdentity.publicKeyAlgorithm,
          fingerprint: deviceIdentity.fingerprint,
        }),
      })

      const sessionPayload = await parseJsonResponse(sessionResponse)

      if (!sessionResponse.ok) {
        throw new Error(getPayloadError(sessionPayload, `Failed to create collab session (${sessionResponse.status})`))
      }

      const parsedSession = (sessionPayload || null) as CollabSession | null

      if (
        !parsedSession?.capabilities ||
        !parsedSession?.token ||
        !parsedSession?.roomId ||
        !parsedSession?.deviceId ||
        !parsedSession?.collabWsUrl ||
        !parsedSession?.protocolVersion ||
        !parsedSession?.encryption
      ) {
        throw new Error('Collab gateway response is invalid')
      }

      const parsedCapabilities = parsedSession.capabilities as CollabCapabilities | undefined

      const nextSession: CollabSession = {
        ...parsedSession,
        deviceLabel: deviceIdentity.deviceLabel,
        deviceFingerprint: deviceIdentity.fingerprint,
        devicePublicKeyJwk: deviceIdentity.publicKeyJwk,
        capabilities: parsedCapabilities ?? {
          execution: 'vm',
          languageScope: ['typescript', 'javascript', 'json', 'markdown', 'html', 'css', 'yaml', 'shell'],
          preview: true,
          terminal: true,
          deployments: false,
          yjs: true,
        },
      }

      setCapabilities(nextSession.capabilities)
      setSession(nextSession)
      setStatus('ready')
      setError(null)
      return nextSession
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to initialize WebSocket collaboration session'
      setStatus('error')
      setSession(null)
      setCapabilities(null)
      setError(message)
      return null
    }
  }, [enabled, gatewayBaseUrl, projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleInvalidation = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectId?: string }>
      if (!projectId || customEvent.detail?.projectId !== projectId) {
        return
      }
      void refresh()
    }

    window.addEventListener(COLLAB_SESSION_INVALIDATION_EVENT, handleInvalidation as EventListener)
    return () => {
      window.removeEventListener(COLLAB_SESSION_INVALIDATION_EVENT, handleInvalidation as EventListener)
    }
  }, [projectId, refresh])

  return {
    status,
    session,
    capabilities,
    error,
    refresh,
  }
}
