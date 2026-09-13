/**
 * The live session for the active Session Workbench, for the session bar.
 *
 * Master Specification: Section 5.3, 6.3, 6.7, 23.2
 * Phase: P23
 *
 * The session is resolved by Workbench identity (workbenchId → workspaceId →
 * collaborationSessionId); its branchName is only a Git property. The branch
 * lookup below runs solely while no workspace is mounted yet, so the bar can
 * resolve membership during bootstrap; it must never decide the open session.
 *
 * Hands the session to the cozea-projectd daemon while this device is an active
 * member, and offers the membership and lifecycle actions the bar shows.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "convex/react"
import type { ProjectdClosePreflight, ProjectdCloseChoice } from "@cozea/projectd-protocol"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"
import { appToast } from "@/lib/appToast"
import { cleanConvexError } from "@/lib/convexError"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { normalizeSessionRepositoryUrl } from "@shared/collaboration/repositoryUrl"
import { findBranchSession, findWorkspaceSession } from "../collaborationGate"
import { useDaemonCollaborationSession } from "../daemon/useDaemonCollaborationSession"
import {
  describeAutoGit,
  describeLiveSessionSync,
  describeTarget,
  resolveMembership,
  type LiveSessionAction,
  type LiveSessionAutoGitView,
  type LiveSessionMember,
  type LiveSessionSyncView,
  type LiveSessionTargetView,
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
  /** The Git remote invitees clone from; absent on sessions started before sessions recorded one. */
  repositoryUrl?: string | null
  /** Whether env files travel with the session although Git ignores them. */
  shareEnvironmentFiles?: boolean
  /** When the session started, in epoch milliseconds. */
  createdAt?: number
}

export interface LiveSessionController {
  /** The session for the active Workbench, if it is a Session Workbench. */
  session: LiveSessionRecord | null
  /** Sessions on the project's other branches that this device is in. */
  otherSessions: LiveSessionRecord[]
  members: LiveSessionMember[]
  membership: SessionMembership
  canManage: boolean
  sync: LiveSessionSyncView | null
  /** How the session is saved to its branch; null when the daemon does not sync this folder. */
  autoGit: LiveSessionAutoGitView | null
  /** How far the branch the session merges into has moved; null until it has been checked. */
  target: LiveSessionTargetView | null
  /** Whether this device may change the session's files. */
  canEdit: boolean
  busyAction: LiveSessionAction | null
  saveNow: () => void
  ignoreEnvironmentFiles: () => void
  checkTarget: () => void
  dismissTarget: () => void
  join: () => void
  leave: () => void
  pause: () => void
  resume: () => void
  end: () => void
  closeReview: ProjectdClosePreflight | null
  cancelClose: () => void
  confirmClose: (choice: ProjectdCloseChoice) => void
  openSessionWorkbench: (branch: string) => void
}

const NO_MEMBERS: LiveSessionMember[] = []

/** Saves the session to its branch now, or asks the Mac that saves it to. */
async function saveSessionNow(publicSessionId: string, branchName: string): Promise<void> {
  const response = await window.electronAPI.projectd.sessions.checkpointNow(publicSessionId)
  if (!response.success) throw new Error(response.error)
  const commit = response.result.lastCheckpoint?.commitOid.slice(0, 7)
  switch (response.result.outcome) {
    case "saved":
      appToast.success({ title: "Saved to Git", description: commit ? `${branchName} is at ${commit}.` : undefined })
      return
    case "requested":
      appToast.info({ title: "Saving to Git", description: "The Mac that saves this session is saving it now." })
      return
    case "no_leader":
      throw new Error("No member's Mac can push this session's branch right now.")
  }
}

/** Adds the session's env files that Git doesn't ignore to .gitignore, so saving to Git resumes. */
async function ignoreSessionEnvironmentFiles(publicSessionId: string): Promise<void> {
  const response = await window.electronAPI.projectd.sessions.ignoreEnvironmentFiles(publicSessionId)
  if (!response.success) throw new Error(response.error)
  if (response.paths.length === 0) {
    appToast.info({ title: ".gitignore already covers the session's env files" })
    return
  }
  appToast.success({
    title: "Added to .gitignore",
    description: `${response.paths.join(", ")}. Saving to Git resumes once .gitignore reaches the Mac that saves.`,
  })
}

async function checkSessionTarget(publicSessionId: string): Promise<void> {
  const response = await window.electronAPI.projectd.sessions.checkTarget(publicSessionId)
  if (!response.success) throw new Error(response.error)
  if (response.target?.error) throw new Error(response.target.error)
}

export function useLiveSession(input: {
  enabled: boolean
  daemonEnabled: boolean
  sessions: readonly LiveSessionRecord[] | undefined
  activeBranch: string
  projectId: string | null
  projectName?: string | null
  workspaceId: string | null
  rootPath: string | null
  principalId: string | null
}): LiveSessionController {
  const navigate = useViewTransitionNavigate()
  const { enabled, daemonEnabled, sessions, activeBranch, workspaceId } = input
  const session = enabled
    ? (findWorkspaceSession(sessions, workspaceId) ??
      (workspaceId ? null : findBranchSession(sessions, activeBranch)))
    : null
  const sessionId = session?._id ?? null

  const membersQuery = useSafeConvexQuery(
    api.collaborationSessions.listMembers,
    sessionId ? { sessionId } : "skip",
  )
  const members: LiveSessionMember[] =
    membersQuery.data?.map((member) => ({ ...member, principalId: String(member.principalId) })) ?? NO_MEMBERS
  const membership = resolveMembership(session?.viewerMembership, members)
  const canManage = membership === "active" && members.some((member) => member.isSelf && member.role === "project_manager")
  const canEdit = membership === "active" && members.some((member) => member.isSelf && member.role !== "viewer")

  const sessionWorkspaceId = session ? `ws_collab_${session.publicSessionId}` : null
  const isSessionWorkspace = Boolean(sessionWorkspaceId && workspaceId === sessionWorkspaceId)
  const daemon = useDaemonCollaborationSession({
    enabled: daemonEnabled && membership === "active" && isSessionWorkspace,
    session,
    projectId: input.projectId,
    workspaceId,
    rootPath: input.rootPath,
    principalId: input.principalId,
  })

  // A session started before sessions recorded their Git remote gets it from the folder
  // of a member who can edit, once that folder syncs with the session.
  const recordRepository = useMutation(api.collaborationSessions.recordRepository)
  const repositoryRecordAttempted = useRef<string | null>(null)
  const sessionRepositoryUrl = session?.repositoryUrl ?? null
  const projectId = input.projectId
  useEffect(() => {
    if (!sessionId || sessionRepositoryUrl || !canEdit || !projectId || daemon.phase !== "attached") return
    if (repositoryRecordAttempted.current === sessionId) return
    repositoryRecordAttempted.current = sessionId
    void window.electronAPI.workspace
      ?.getActiveForProject(projectId)
      .then((workspace) => {
        const repositoryUrl = normalizeSessionRepositoryUrl(workspace?.gitOriginUrl)
        return repositoryUrl ? recordRepository({ sessionId, repositoryUrl }) : undefined
      })
      .catch((error: unknown) => console.warn("[LiveSession] Could not record the session's Git remote:", error))
  }, [sessionId, sessionRepositoryUrl, canEdit, projectId, daemon.phase, recordRepository])

  const joinSession = useMutation(api.collaborationSessions.join)
  const leaveSession = useMutation(api.collaborationSessions.leave)
  const resumeSession = useMutation(api.collaborationSessions.resume)
  const [closeReview, setCloseReview] = useState<ProjectdClosePreflight | null>(null)
  const [busyAction, setBusyAction] = useState<LiveSessionAction | null>(null)

  const run = useCallback((action: LiveSessionAction, failure: string, work: () => Promise<unknown>) => {
    setBusyAction(action)
    work()
      .catch((error: unknown) => {
        appToast.error({ title: failure, description: cleanConvexError(error, failure) })
      })
      .finally(() => setBusyAction(null))
  }, [])

  const ensureAndOpenSessionWorkbench = useCallback(
    async (target: LiveSessionRecord) => {
      if (!input.projectId) throw new Error("Open this project first.")
      const ensured = await window.electronAPI.projectd.workbenches.ensureSession({
        projectId: input.projectId,
        publicSessionId: target.publicSessionId,
        branchName: target.branchName,
        baseBranch: target.branchName,
        createBranch: false,
        title: `${input.projectName ?? "Project"} · ${target.branchName}`,
        sourceRepoUrl: target.repositoryUrl ?? null,
        sourceWorkspaceId: workspaceId,
        includeDirtyChanges: false,
        setActive: true,
      })
      if (!ensured.success) throw new Error(ensured.error)
      navigate(buildProjectPath(input.projectId, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId: input.projectId,
          projectName: input.projectName ?? null,
          preferredWorkspaceId: ensured.workspace.workspaceId,
        }),
      })
    },
    [input.projectId, input.projectName, navigate, workspaceId],
  )

  const onSession = (
    action: LiveSessionAction,
    failure: string,
    mutate: (args: { sessionId: Id<"collaborationSessions"> }) => Promise<unknown>,
  ) => () => {
    if (sessionId) run(action, failure, async () => {
      let retainedBatches = 0
      let retainedBinaryVersions = 0
      if (action === "leave" && session) {
        const prepared = await window.electronAPI.projectd.sessions.prepareLeave(session.publicSessionId)
        if (!prepared.success) throw new Error(prepared.error)
        retainedBatches = prepared.pendingBatches
        retainedBinaryVersions = prepared.pendingBinaryVersions
      }
      await mutate({ sessionId })
      if ((action === "leave" || action === "end") && session) {
        const result = await window.electronAPI.projectd.sessions.detach(session.publicSessionId)
        if (!result.success) throw new Error(result.error)
      }
      if (retainedBatches > 0 || retainedBinaryVersions > 0) {
        appToast.info({ title: "Left collaboration", description: "Some edits were not confirmed by the session. Their recovery data remains on this Mac." })
      }
    })
  }

  const otherSessions = enabled
    ? (sessions ?? []).filter(
        (candidate) =>
          candidate.publicSessionId !== session?.publicSessionId &&
          candidate.lifecycle !== "CLOSED" &&
          candidate.viewerMembership === "active",
      )
    : []

  const daemonStatus = daemonEnabled && daemon.phase === "attached" ? daemon.status : null
  const leaderName =
    members.find((member) => member.principalId === daemonStatus?.autoGit?.leaderPrincipalId)?.displayName ?? null

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
    autoGit: session ? describeAutoGit(daemonStatus, leaderName) : null,
    target: session ? describeTarget(daemonStatus?.target ?? null) : null,
    canEdit,
    busyAction,
    saveNow: () => {
      if (session) run("save", "Could not save to Git", () => saveSessionNow(session.publicSessionId, session.branchName))
    },
    ignoreEnvironmentFiles: () => {
      if (session) {
        run("ignore_env", "Could not update .gitignore", () => ignoreSessionEnvironmentFiles(session.publicSessionId))
      }
    },
    checkTarget: () => {
      if (session) {
        run("check_target", `Could not check ${session.targetBranch}`, () => checkSessionTarget(session.publicSessionId))
      }
    },
    dismissTarget: () => {
      if (session) void window.electronAPI.projectd.sessions.dismissTarget(session.publicSessionId)
    },
    join: () => {
      if (!sessionId || !session) return
      run("join", "Could not join the session", async () => {
        await joinSession({ sessionId })
        await ensureAndOpenSessionWorkbench(session)
      })
    },
    leave: onSession("leave", "Could not leave the session", leaveSession),
    pause: () => {
      if (session) run("pause", "Could not pause the session", async () => {
        const result = await window.electronAPI.projectd.sessions.pause(session.publicSessionId)
        if (!result.success) throw new Error(result.error)
        if (result.gitLag) appToast.info({ title: "Collaboration paused", description: "Your session is retained in encrypted cloud storage. Git has not saved all of its changes yet." })
      })
    },
    resume: onSession("resume", "Could not resume the session", resumeSession),
    closeReview: closeReview?.publicSessionId === session?.publicSessionId ? closeReview : null,
    cancelClose: () => setCloseReview(null),
    confirmClose: (choice) => {
      if (session) run("end", "Could not close the session", async () => {
        const result = await window.electronAPI.projectd.sessions.close(session.publicSessionId, choice)
        if (!result.success) {
          if (result.code === "REVIEW_CHANGED" || result.code === "REVIEW_REQUIRED" || result.code === "SNAPSHOT_BEHIND" ||
            result.code === "CLOSE_REVIEW_CHANGED") setCloseReview(null)
          throw new Error(result.error)
        }
        setCloseReview(null)
        const detached = await window.electronAPI.projectd.sessions.detach(session.publicSessionId)
        if (!detached.success) throw new Error(detached.error)
      })
    },
    end: () => {
      if (session) run("end", "Could not review session closure", async () => {
        const result = await window.electronAPI.projectd.sessions.prepareClose(session.publicSessionId)
        if (!result.success) throw new Error(result.error)
        setCloseReview(result.review)
      })
    },
    openSessionWorkbench: (branch) =>
      run("switch", `Could not open ${branch}`, async () => {
        const target = (sessions ?? []).find((candidate) => candidate.branchName === branch)
        if (!target) throw new Error(`The live session on ${branch} is no longer available.`)
        await ensureAndOpenSessionWorkbench(target)
      }),
  }
}
