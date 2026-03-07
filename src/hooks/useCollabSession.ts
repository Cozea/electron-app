import { useCallback, useEffect, useMemo, useState } from 'react'

interface CollabCapabilities {
  execution: 'browser-local' | 'vm'
  languageScope: string[]
  preview: boolean
  terminal: boolean
  deployments: boolean
  yjs: boolean
}

export interface CollabSession {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  capabilities: CollabCapabilities
}

interface UseCollabSessionOptions {
  projectId: string | null
  accessToken: string | null
  enabled?: boolean
}

interface UseCollabSessionResult {
  status: 'idle' | 'loading' | 'ready' | 'error'
  session: CollabSession | null
  capabilities: CollabCapabilities | null
  error: string | null
  refresh: () => Promise<CollabSession | null>
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
  accessToken,
  enabled = true,
}: UseCollabSessionOptions): UseCollabSessionResult {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [session, setSession] = useState<CollabSession | null>(null)
  const [capabilities, setCapabilities] = useState<CollabCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)

  const gatewayBaseUrl = useMemo(
    () => normalizeGatewayBaseUrl(import.meta.env.VITE_AUTH_SERVER_URL),
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

    if (!accessToken || !gatewayBaseUrl) {
      setStatus('error')
      setError('Collab gateway is not configured')
      setSession(null)
      setCapabilities(null)
      return null
    }

    setStatus('loading')
    setError(null)

    console.info('[CollabSession] Initializing collaboration session', {
      projectId,
    })

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    try {
      const [capabilityResponse, sessionResponse] = await Promise.all([
        fetch(`${gatewayBaseUrl}/collab/capabilities?projectId=${encodeURIComponent(projectId)}`, {
          method: 'GET',
          headers: authHeaders,
          credentials: 'include',
        }),
        fetch(`${gatewayBaseUrl}/collab/session`, {
          method: 'POST',
          headers: authHeaders,
          credentials: 'include',
          body: JSON.stringify({
            projectId,
            clientType: 'electron',
          }),
        }),
      ])

      const [capabilityPayload, sessionPayload] = await Promise.all([
        parseJsonResponse(capabilityResponse),
        parseJsonResponse(sessionResponse),
      ])

      if (!capabilityResponse.ok) {
        throw new Error(getPayloadError(capabilityPayload, `Failed to fetch collab capabilities (${capabilityResponse.status})`))
      }
      if (!sessionResponse.ok) {
        throw new Error(getPayloadError(sessionPayload, `Failed to create collab session (${sessionResponse.status})`))
      }

      const parsedCapabilities = (capabilityPayload || null) as CollabCapabilities | null
      const parsedSession = (sessionPayload || null) as CollabSession | null

      if (!parsedCapabilities || !parsedSession?.token || !parsedSession?.roomId) {
        throw new Error('Collab gateway response is invalid')
      }

      setCapabilities(parsedCapabilities)
      setSession(parsedSession)
      setStatus('ready')
      setError(null)
      console.info('[CollabSession] Collaboration session ready', {
        projectId,
        roomId: parsedSession.roomId,
        wsUrl: parsedSession.collabWsUrl,
      })
      return parsedSession
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to initialize collaboration session'
      console.warn('[CollabSession] Failed to initialize collaboration session', {
        projectId,
        error: message,
      })
      setStatus('error')
      setSession(null)
      setCapabilities(null)
      setError(message)
      return null
    }
  }, [accessToken, enabled, gatewayBaseUrl, projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    status,
    session,
    capabilities,
    error,
    refresh,
  }
}
