import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { validateDeviceGatewayUrl } from "@shared/gatewayUrl"
import { getDeviceSession } from "@/lib/deviceSession"

const COLLAB_SESSION_INVALIDATION_EVENT = "cozea:collab-session-invalidate"

interface CollabCapabilities {
  execution: "browser-local" | "vm"
  languageScope: string[]
  preview: boolean
  terminal: boolean
  deployments: boolean
  yjs: boolean
}

export interface CollabEncryptionBootstrap {
  roomId: string
  encryptionRequired: boolean
  status: "room_not_initialized" | "ready" | "missing_for_device" | "device_revoked"
  activeKeyVersion: number | null
  wrappedRoomKey: string | null
  wrapAlgorithm: string | null
  senderPublicKeyJwk: string | null
}

export interface CollabSession {
  projectId: string
  sessionId?: string
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
  sessionId?: string | null
  enabled?: boolean
}

interface UseCollabSessionResult {
  status: "idle" | "loading" | "ready" | "error"
  session: CollabSession | null
  capabilities: CollabCapabilities | null
  error: string | null
  refresh: () => Promise<CollabSession | null>
}

export function invalidateCollabSession(projectId: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(COLLAB_SESSION_INVALIDATION_EVENT, { detail: { projectId } }))
}

function normalizeGatewayBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed.replace(/\/+$/, "") : null
}

function getPayloadError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback
  const data = payload as Record<string, unknown>
  const nested = data.payload && typeof data.payload === "object"
    ? data.payload as Record<string, unknown>
    : null
  if (typeof nested?.message === "string" && nested.message.trim()) return nested.message
  if (typeof data.error === "string" && data.error.trim()) return data.error
  if (typeof data.message === "string" && data.message.trim()) return data.message
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
  sessionId = null,
  enabled = true,
}: UseCollabSessionOptions): UseCollabSessionResult {
  const currentSessionRef = useRef<CollabSession | null>(null)
  const requestGenerationRef = useRef(0)
  const [status, setStatus] = useState<UseCollabSessionResult["status"]>("idle")
  const [session, setSession] = useState<CollabSession | null>(null)
  const [capabilities, setCapabilities] = useState<CollabCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)

  const gatewayBaseUrl = useMemo(
    () => normalizeGatewayBaseUrl(import.meta.env.VITE_COLLAB_BASE_URL) ??
      normalizeGatewayBaseUrl(import.meta.env.VITE_AUTH_SERVER_URL),
    [],
  )

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current
    if (!enabled || !projectId) {
      currentSessionRef.current = null
      setStatus("idle")
      setSession(null)
      setCapabilities(null)
      setError(null)
      return null
    }
    if (!gatewayBaseUrl) {
      setStatus("error")
      setError("WebSocket collaboration gateway is not configured")
      setSession(null)
      setCapabilities(null)
      return null
    }

    const current = currentSessionRef.current
    if (!current || current.projectId !== projectId || (current.sessionId ?? null) !== sessionId) {
      setStatus("loading")
      setSession(null)
    }
    setError(null)
    try {
      const validatedGatewayUrl = validateDeviceGatewayUrl(gatewayBaseUrl)
      const [deviceIdentity, deviceSession] = await Promise.all([
        window.electronAPI.collab.ensureDeviceIdentity(),
        getDeviceSession(),
      ])
      const path = sessionId ? "/collab/v2/session" : "/collab/session"
      const response = await fetch(`${validatedGatewayUrl}${path}`, {
        redirect: "error",
        cache: "no-store",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deviceSession.accessToken}`,
        },
        body: JSON.stringify({
          projectId,
          sessionId: sessionId ?? undefined,
          clientType: "electron",
          deviceId: deviceIdentity.deviceId,
          deviceLabel: deviceIdentity.deviceLabel,
          platform: deviceIdentity.platform,
          publicKeyJwk: deviceIdentity.publicKeyJwk,
          publicKeyAlgorithm: deviceIdentity.publicKeyAlgorithm,
          fingerprint: deviceIdentity.fingerprint,
        }),
      })
      const payload = await parseJsonResponse(response)
      if (!response.ok) {
        throw new Error(getPayloadError(payload, `Failed to create collaboration session (${response.status})`))
      }
      const parsed = payload as CollabSession | null
      if (
        !parsed?.capabilities ||
        !parsed.token ||
        !parsed.roomId ||
        !parsed.deviceId ||
        !parsed.collabWsUrl ||
        !parsed.protocolVersion ||
        !parsed.encryption ||
        (sessionId && parsed.sessionId !== sessionId)
      ) {
        throw new Error("Collaboration gateway response is invalid")
      }

      const next: CollabSession = {
        ...parsed,
        deviceLabel: deviceIdentity.deviceLabel,
        deviceFingerprint: deviceIdentity.fingerprint,
        devicePublicKeyJwk: deviceIdentity.publicKeyJwk,
      }
      if (generation !== requestGenerationRef.current) return null
      currentSessionRef.current = next
      setCapabilities(next.capabilities)
      setSession(next)
      setStatus("ready")
      return next
    } catch (requestError) {
      if (generation !== requestGenerationRef.current) return null
      const message = requestError instanceof Error
        ? requestError.message
        : "Failed to initialize WebSocket collaboration session"
      setStatus("error")
      setSession(null)
      setCapabilities(null)
      setError(message)
      return null
    }
  }, [enabled, gatewayBaseUrl, projectId, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      if (projectId && detail?.projectId === projectId) void refresh()
    }
    window.addEventListener(COLLAB_SESSION_INVALIDATION_EVENT, handleInvalidation as EventListener)
    return () => window.removeEventListener(COLLAB_SESSION_INVALIDATION_EVENT, handleInvalidation as EventListener)
  }, [projectId, refresh])

  const matches = !session || (session.projectId === projectId && (session.sessionId ?? null) === sessionId)
  return {
    status: matches ? status : "loading",
    session: matches ? session : null,
    capabilities: matches ? capabilities : null,
    error,
    refresh,
  }
}
