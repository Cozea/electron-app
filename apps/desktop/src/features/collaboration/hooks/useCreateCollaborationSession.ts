/**
 * Hook creating a Collaboration Session record (Section 6.1).
 *
 * Master Specification: Section 6.1
 * Phase: P14
 *
 * This creates the cloud session record only, with the Git remote invitees clone from.
 * The creator's folder already is the session's folder; an invitee without a copy
 * gets one when they accept (features/inbox/sessionCopy.ts). So the hook reports
 * "ready" once the record exists.
 */

import { useState, useCallback } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import type { SessionAccessMode } from "@shared/collaboration"

export type CreateSessionStage = "idle" | "creating_session" | "ready" | "error"

export interface CreateSessionParams {
  projectId: Id<"projects">
  repositoryBindingId: string
  branchName: string
  targetBranch?: string
  includeDirtyChanges?: boolean
  accessMode: SessionAccessMode
  organizationId?: Id<"organizations">
  /** The folder's Git remote; invitees without a copy clone it. */
  repositoryUrl?: string | null
  /** Share env files (.env) through the session although Git ignores them. */
  shareEnvironmentFiles?: boolean
}

export interface CreateSessionResult {
  sessionId: Id<"collaborationSessions">
  publicSessionId: string
}

export function useCreateCollaborationSession() {
  const [stage, setStage] = useState<CreateSessionStage>("idle")
  const [error, setError] = useState<string | null>(null)

  const createSessionMutation = useMutation(api.collaborationSessions.create)

  const startCollaboration = useCallback(
    async (params: CreateSessionParams): Promise<CreateSessionResult> => {
      setError(null)
      setStage("creating_session")

      try {
        // The server records the authenticated device as the creator.
        const sessionRecord = await createSessionMutation({
          projectId: params.projectId,
          repositoryBindingId: params.repositoryBindingId,
          branchName: params.branchName,
          targetBranch: params.targetBranch ?? "main",
          accessMode: params.accessMode,
          organizationId: params.organizationId,
          repositoryUrl: params.repositoryUrl ?? undefined,
          shareEnvironmentFiles: params.shareEnvironmentFiles ?? false,
        })

        setStage("ready")

        return {
          sessionId: sessionRecord.sessionId,
          publicSessionId: sessionRecord.publicSessionId,
        }
      } catch (err: any) {
        setStage("error")
        setError(err.message ?? "Failed to start collaboration session")
        throw err
      }
    },
    [createSessionMutation],
  )

  const reset = useCallback(() => {
    setStage("idle")
    setError(null)
  }, [])

  return {
    stage,
    error,
    startCollaboration,
    reset,
  }
}
