/**
 * The live session on the project's active branch, for the session bar.
 *
 * Master Specification: Section 5.3, 6.3, 6.7, 23.2
 * Phase: P23
 *
 * Hands the session to the cozea-projectd daemon while this device is an active
 * member, and offers the membership and lifecycle actions the bar shows.
 */

import { useCallback, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"
import { appToast } from "@/lib/appToast"
import { cleanConvexError } from "@/lib/convexError"
import { checkoutGitBranchCompat } from "@/features/workbench/branch-control/workbenchBranchCompat"
import { findBranchSession } from "../collaborationGate"
import { useDaemonCollaborationSession } from "../daemon/useDaemonCollaborationSession"
import {
  describeLiveSessionSync,
  resolveMembership,
  type LiveSessionAction,
  type LiveSessionMember,
  type LiveSessionSyncView,
  type SessionMembership,
} from "./liveSessionModel"

export interface LiveSessionRecord {
  _id: Id<"collaborationSessions">
  publicSessionId: string
  branchName: string
  targetBranch: string
  lifecycle: string
  /** This device's membership status; null when it is not a member. */
  viewerMembership?: string | null
}

export interface LiveSessionController {
  /** The session on the active branch. */
  session: LiveSessionRecord | null
  /** Sessions on the project's other branches that this device is in. */
  otherSessions: LiveSessionRecord[]
  members: LiveSessionMember[]
  membership: SessionMembership
  canManage: boolean
  sync: LiveSessionSyncView | null
  busyAction: LiveSessionAction | null
  join: () => void
  leave: () => void
  pause: () => void
  resume: () => void
  end: () => void
  switchToBranch: (branch: string) => void
}

const NO_MEMBERS: LiveSessionMember[] = []

export function useLiveSession(input: {
  enabled: boolean
  daemonEnabled: boolean
  sessions: readonly LiveSessionRecord[] | undefined
  activeBranch: string
  projectId: string | null
  workspaceId: string | null
  rootPath: string | null
  principalId: string | null
  onBranchSwitched?: () => Promise<void> | void
}): LiveSessionController {
  const { enabled, daemonEnabled, sessions, activeBranch, workspaceId, onBranchSwitched } = input
  const session = enabled ? findBranchSession(sessions, activeBranch) : null
  const sessionId = session?._id ?? null

  const membersQuery = useSafeConvexQuery(
    api.collaborationSessions.listMembers,
    sessionId ? { sessionId } : "skip",
  )
  const members: LiveSessionMember[] =
    membersQuery.data?.map((member) => ({ ...member, principalId: String(member.principalId) })) ?? NO_MEMBERS
  const membership = resolveMembership(session?.viewerMembership, members)
  const canManage = membership === "active" && members.some((member) => member.isSelf && member.role === "project_manager")

  const daemon = useDaemonCollaborationSession({
    enabled: daemonEnabled && membership === "active",
    session,
    projectId: input.projectId,
    workspaceId,
    rootPath: input.rootPath,
    principalId: input.principalId,
  })

  const joinSession = useMutation(api.collaborationSessions.join)
  const leaveSession = useMutation(api.collaborationSessions.leave)
  const pauseSession = useMutation(api.collaborationSessions.pause)
  const resumeSession = useMutation(api.collaborationSessions.resume)
  const closeSession = useMutation(api.collaborationSessions.close)
  const [busyAction, setBusyAction] = useState<LiveSessionAction | null>(null)

  const run = useCallback((action: LiveSessionAction, failure: string, work: () => Promise<unknown>) => {
    setBusyAction(action)
    work()
      .catch((error: unknown) => {
        appToast.error({ title: failure, description: cleanConvexError(error, failure) })
      })
      .finally(() => setBusyAction(null))
  }, [])

  const onSession = (
    action: LiveSessionAction,
    failure: string,
    mutate: (args: { sessionId: Id<"collaborationSessions"> }) => Promise<unknown>,
  ) => () => {
    if (sessionId) run(action, failure, () => mutate({ sessionId }))
  }

  const otherSessions = enabled
    ? (sessions ?? []).filter(
        (candidate) =>
          candidate.branchName !== activeBranch &&
          candidate.lifecycle !== "CLOSED" &&
          candidate.viewerMembership === "active",
      )
    : []

  return {
    session,
    otherSessions,
    members,
    membership,
    canManage,
    sync: session
      ? describeLiveSessionSync({
          lifecycle: session.lifecycle,
          membership,
          daemonEnabled,
          phase: daemon.phase,
          status: daemon.status,
          error: daemon.error,
        })
      : null,
    busyAction,
    join: onSession("join", "Could not join the session", joinSession),
    leave: onSession("leave", "Could not leave the session", leaveSession),
    pause: onSession("pause", "Could not pause the session", pauseSession),
    resume: onSession("resume", "Could not resume the session", resumeSession),
    end: onSession("end", "Could not end the session", closeSession),
    switchToBranch: (branch) =>
      run("switch", `Could not switch to ${branch}`, async () => {
        if (!workspaceId) throw new Error("Open this project's folder first.")
        const result = await checkoutGitBranchCompat(workspaceId, branch)
        if (!result.success) throw new Error(result.error ?? `Git could not check out ${branch}.`)
        await onBranchSwitched?.()
      }),
  }
}
