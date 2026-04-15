import { useCallback, useEffect, useMemo, useState } from 'react'

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
  status: 'plaintext_legacy' | 'room_not_initialized' | 'ready' | 'missing_for_device' | 'device_revoked'
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
      setError('WebSocket collaboration gateway is not configured')
      setSession(null)
      setCapabilities(null)
      return null
    }

    setStatus('loading')
    setError(null)

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    try {
      const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity()

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
            deviceId: deviceIdentity.deviceId,
            deviceLabel: deviceIdentity.deviceLabel,
            platform: deviceIdentity.platform,
            publicKeyJwk: deviceIdentity.publicKeyJwk,
            publicKeyAlgorithm: deviceIdentity.publicKeyAlgorithm,
            fingerprint: deviceIdentity.fingerprint,
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

      if (
        !parsedCapabilities ||
        !parsedSession?.token ||
        !parsedSession?.roomId ||
        !parsedSession?.deviceId ||
        !parsedSession?.encryption
      ) {
        throw new Error('Collab gateway response is invalid')
      }

      const nextSession: CollabSession = {
        ...parsedSession,
        deviceLabel: deviceIdentity.deviceLabel,
        deviceFingerprint: deviceIdentity.fingerprint,
        devicePublicKeyJwk: deviceIdentity.publicKeyJwk,
        capabilities: parsedCapabilities,
      }

      setCapabilities(parsedCapabilities)
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
