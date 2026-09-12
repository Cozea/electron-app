/**
 * Runs the branch's live session through the cozea-projectd daemon while the
 * project is open, and shares the room key with members who joined after this
 * device got it.
 */

import { useEffect, useState } from "react"
import { useConvex, type ConvexReactClient } from "convex/react"

import type { ProjectdSessionStatus, ProjectdSessionTicket } from "@cozea/projectd-protocol"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"
import { generateRoomKeyBase64 } from "@/lib/collab/cipherEnvelope"
import { getDeviceGatewayBaseUrl, getDeviceSession } from "@/lib/deviceSession"
import {
  SessionKeyNotSharedError,
  connectDaemonSession,
  shareSessionKeyWithMembers,
  type DaemonSessionConnection,
  type DaemonSessionDeps,
  type DaemonSessionTarget,
} from "./daemonSessionConnector"

const KEY_RETRY_MS = 10_000
// The daemon may still be starting, or restarting after an app update.
const UNAVAILABLE_RETRY_MS = [3_000, 10_000, 30_000, 60_000]
// A restarted daemon has forgotten its sessions, so an attached session checks it is still there.
const ATTACHED_CHECK_MS = 15_000

export type DaemonSessionPhase = "off" | "connecting" | "waiting_for_key" | "attached" | "unavailable"

export interface DaemonCollaborationState {
  phase: DaemonSessionPhase
  status: ProjectdSessionStatus | null
  error: string | null
}

const OFF: DaemonCollaborationState = { phase: "off", status: null, error: null }

interface DaemonSessionRecord {
  _id: Id<"collaborationSessions">
  publicSessionId: string
  branchName: string
  lifecycle: string
  shareEnvironmentFiles?: boolean
  targetBranch?: string
  createdAt?: number
}

async function requestSessionTicket(publicSessionId: string): Promise<ProjectdSessionTicket> {
  const deviceSession = await getDeviceSession()
  const response = await fetch(`${getDeviceGatewayBaseUrl()}/collab/sessions/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deviceSession.accessToken}` },
    body: JSON.stringify({ publicSessionId, clientType: "electron" }),
  })
  const body = (await response.json().catch(() => null)) as
    | (Partial<ProjectdSessionTicket> & { payload?: { message?: string }; message?: string })
    | null
  if (!response.ok || !body?.wsUrl || !body.token) {
    throw new Error(
      body?.payload?.message ?? body?.message ?? `The session room refused the connection (${response.status}).`,
    )
  }
  return { wsUrl: body.wsUrl, token: body.token, role: body.role }
}

function createDaemonSessionDeps(convex: ConvexReactClient): DaemonSessionDeps {
  const { collab, projectd } = window.electronAPI
  const sessionIdOf = (sessionId: string) => sessionId as Id<"collaborationSessions">
  return {
    getSessionKey: (sessionId) =>
      convex.query(api.collaborationSessions.getSessionKeyForDevice, { sessionId: sessionIdOf(sessionId) }),
    getSessionKeyring: (sessionId) =>
      convex.query(api.collaborationSessions.getSessionKeyringForDevice, { sessionId: sessionIdOf(sessionId) }),
    initializeSessionKey: (input) =>
      convex.mutation(api.collaborationSessions.initializeSessionKey, {
        ...input,
        sessionId: sessionIdOf(input.sessionId),
      }),
    listMembersNeedingKey: async (sessionId, keyVersion) => {
      const recipients = await convex.query(api.collaborationSessions.listMembersNeedingSessionKey, {
        sessionId: sessionIdOf(sessionId),
        keyVersion,
      })
      return recipients.map((recipient) => ({ ...recipient, principalId: String(recipient.principalId) }))
    },
    shareSessionKey: (input) =>
      convex.mutation(api.collaborationSessions.shareSessionKey, {
        ...input,
        sessionId: sessionIdOf(input.sessionId),
        recipientPrincipalId: input.recipientPrincipalId as Id<"devicePrincipals">,
      }),
    getOwnEncryptionPublicKeyJwk: async () => (await collab.ensureDeviceIdentity()).publicKeyJwk,
    wrapRoomKey: (input) => collab.wrapRoomKey(input),
    unwrapRoomKey: (input) => collab.unwrapRoomKey(input),
    generateRoomKeyBase64,
    requestTicket: requestSessionTicket,
    daemon: projectd.sessions,
  }
}

export function useDaemonCollaborationSession(input: {
  enabled: boolean
  session: DaemonSessionRecord | null
  projectId: string | null
  workspaceId: string | null
  rootPath: string | null
  principalId: string | null
}): DaemonCollaborationState {
  const convex = useConvex()
  const [state, setState] = useState<DaemonCollaborationState>(OFF)

  const { enabled, session, projectId, workspaceId, rootPath, principalId } = input

  // Navigation only changes subscriptions. Explicit Leave removes durable intent;
  // the daemon independently rechecks membership and lifecycle in the background.
  const keyState = useSafeConvexQuery(
    api.collaborationSessions.getSessionKeyForDevice,
    enabled && session?.lifecycle === "ACTIVE"
      ? { sessionId: session._id }
      : "skip",
  )
  const target: DaemonSessionTarget | null =
    enabled && session?.lifecycle === "ACTIVE" && projectId && workspaceId && rootPath
      ? {
          sessionId: String(session._id),
          publicSessionId: session.publicSessionId,
          projectId,
          workspaceId,
          rootPath,
          principalId,
          branchName: session.branchName,
          shareEnvironmentFiles: session.shareEnvironmentFiles === true,
          targetBranch: session.targetBranch ?? null,
          sessionStartedAt: session.createdAt ?? null,
          keyVersionHint: keyState.data?.keyVersion ?? null,
        }
      : null
  // A string, so a new but equal target object does not reconnect.
  const targetKey = target ? JSON.stringify(target) : null

  useEffect(() => {
    if (!targetKey) return
    const connectTarget = JSON.parse(targetKey) as DaemonSessionTarget
    const deps = createDaemonSessionDeps(convex)
    let cancelled = false
    let connection: DaemonSessionConnection | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let checkTimer: ReturnType<typeof setInterval> | null = null
    let failures = 0

    const stopChecking = () => {
      if (checkTimer) clearInterval(checkTimer)
      checkTimer = null
    }

    // Attaches again when the daemon no longer has the session, after a restart or while it is
    // down, or stopped syncing it, as when the folder held changes the session would overwrite.
    const checkAttachment = async () => {
      const result = await window.electronAPI.projectd.sessions.status(connectTarget.publicSessionId)
      if (cancelled) return
      const failed = result.success && result.status?.state === "failed"
      if (result.success && result.status && !failed) return
      stopChecking()
      connection?.stopListening()
      connection = null
      void attempt(failed)
    }

    // A quiet attempt keeps showing the current state until the daemon reports a new one.
    const attempt = async (quiet = false) => {
      if (!quiet) {
        setState((current) =>
          current.phase === "unavailable" ? current : { phase: "connecting", status: null, error: null },
        )
      }
      try {
        const connected = await connectDaemonSession(deps, connectTarget, (status) => {
          if (!cancelled) setState({ phase: "attached", status, error: status.lastError?.message ?? null })
        }, (error) => {
          if (cancelled) return
          setState((current) => {
            if ((!error.code || error.code === "INTERNAL_ERROR") && current.phase === "attached" && current.status) {
              return { ...current, error: error.message }
            }
            return { phase: error.code === "SESSION_KEY_MISSING" || error.code === "SESSION_KEY_CHANGED" ? "waiting_for_key" : "unavailable",
              status: null, error: error.message }
          })
        })
        if (cancelled) {
          connected.stopListening()
          return
        }
        connection = connected
        failures = 0
        setState((current) => (current.phase === "attached" ? current : { phase: "attached", status: null, error: null }))
        checkTimer = setInterval(() => void checkAttachment(), ATTACHED_CHECK_MS)
      } catch (error) {
        if (cancelled) return
        if (error instanceof SessionKeyNotSharedError) {
          setState({ phase: "waiting_for_key", status: null, error: error.message })
          retryTimer = setTimeout(() => void attempt(), KEY_RETRY_MS)
          return
        }
        console.warn("[DaemonSession] The daemon could not take this session", error)
        setState({ phase: "unavailable", status: null, error: error instanceof Error ? error.message : String(error) })
        retryTimer = setTimeout(() => void attempt(), UNAVAILABLE_RETRY_MS[Math.min(failures, UNAVAILABLE_RETRY_MS.length - 1)])
        failures += 1
      }
    }
    void attempt()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      stopChecking()
      connection?.stopListening()
    }
  }, [convex, targetKey])

  const sharingSessionId = target && state.phase === "attached" ? target.sessionId : null
  const membersNeedingKey = useSafeConvexQuery(
    api.collaborationSessions.listMembersNeedingSessionKey,
    sharingSessionId ? { sessionId: sharingSessionId as Id<"collaborationSessions"> } : "skip",
  )
  const needingKeyCount = membersNeedingKey.data?.length ?? 0

  useEffect(() => {
    if (!sharingSessionId || needingKeyCount === 0) return
    shareSessionKeyWithMembers(createDaemonSessionDeps(convex), sharingSessionId).catch(
      (error: unknown) => {
        console.warn("[DaemonSession] Could not share the session key", error)
      },
    )
  }, [convex, sharingSessionId, needingKeyCount])

  return targetKey ? state : OFF
}
