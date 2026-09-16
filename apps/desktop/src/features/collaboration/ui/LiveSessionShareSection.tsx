/**
 * Live session part of the Share dialog.
 *
 * Master Specification: Section 6.1, 6.2, 6.4
 * Phase: P14
 *
 * Starts a live session on the branch this folder has checked out, invites people to
 * it, and switches to the project's sessions on other branches.
 */

import { useState, type ReactNode } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/contexts/AuthContext"
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext"
import { cleanConvexError } from "@/lib/convexError"
import { appToast } from "@/lib/appToast"
import { formatCloneErrorMessage } from "@/lib/git/gitErrorFormatting"
import { useSwitchToSessionWorkbench } from "@/features/collaboration/live/useSwitchToSessionWorkbench"
import { cn } from "@/lib/utils"
import { useProjectSessions } from "@/features/collaboration/hooks/useProjectSessions"
import { findBranchSession, findWorkspaceSession } from "../collaborationGate"

type SessionRole = "viewer" | "developer" | "project_manager"

export interface ShareableProjectMember {
  principalId: Id<"devicePrincipals">
  displayName: string
  role: string
}

/** A project member joins a session in the matching session role. */
function sessionRoleFor(projectRole: string): SessionRole {
  if (projectRole === "viewer") return "viewer"
  return projectRole === "project_manager" ? "project_manager" : "developer"
}

export function LiveSessionShareSection({
  projectId,
  projectMembers,
  canManageProject,
  onStartSession,
  onLeaveSession,
}: {
  projectId: Id<"projects">
  projectMembers: readonly ShareableProjectMember[] | undefined
  canManageProject: boolean
  onStartSession: () => void
  onLeaveSession?: () => void
}) {
  const { principalId } = useAuth()
  const sync = useOptionalProjectSyncContext()
  const route = useOptionalProjectRouteContext()
  const activeBranch = sync?.activeBranch ?? null
  const workspaceId = sync?.workspaceId ?? null

  const sessions = useProjectSessions(projectId)
  // The Workbench decides the session. When in a regular workspace, fall back to the active branch's session.
  const activeSession =
    findWorkspaceSession(sessions, workspaceId) ??
    (activeBranch ? findBranchSession(sessions, activeBranch) : null) ??
    sessions?.[0] ??
    null
  const sessionMembers = useQuery(
    api.collaborationSessions.listMembers,
    activeSession ? { sessionId: activeSession._id } : "skip",
  )
  const invite = useMutation(api.collaborationSessions.inviteParticipant)
  const updateAccessMode = useMutation(api.collaborationSessions.updateAccessMode)
  const { openSessionWorkbench: switchToSessionWorkbench } = useSwitchToSessionWorkbench({
    projectId,
    projectName: route?.projectName ?? null,
    sourceWorkspaceId: workspaceId,
  })
  const leaveSessionMutation = useMutation(api.collaborationSessions.leave)
  const endSessionMutation = useMutation(api.collaborationSessions.close)

  const [identityKey, setIdentityKey] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: ReactNode } | null>(null)

  const run = async (key: string, work: () => Promise<string>, describeError?: (error: unknown) => ReactNode) => {
    setBusy(key)
    setMessage(null)
    try {
      setMessage({ kind: "notice", text: await work() })
    } catch (caught) {
      setMessage({
        kind: "error",
        text: describeError ? describeError(caught) : cleanConvexError(caught, "Could not update the live session."),
      })
    } finally {
      setBusy(null)
    }
  }

  // Clone failures carry raw multi-line git output; when the repo is
  // unreachable show the concise repo link instead.
  const describeWorkbenchError = (repoUrl: string | null | undefined) => (caught: unknown) => {
    const message = caught instanceof Error ? caught.message : null
    const formatted = formatCloneErrorMessage(message, repoUrl)
    return typeof formatted === "string" ? cleanConvexError(caught, "Could not open the Session Workbench") : formatted
  }

  const self = sessionMembers?.find((member) => member.isSelf)
  const canInvite = canManageProject || (self?.status === "active" && self.role === "project_manager")
  const inSession = (sessionMembers ?? []).filter((member) => member.status === "active")
  const inSessionIds = new Set(inSession.map((member) => String(member.principalId)))
  const invitable = (projectMembers ?? []).filter(
    (member) => !inSessionIds.has(String(member.principalId)) && String(member.principalId) !== String(principalId),
  )
  const otherSessions = (sessions ?? []).filter((candidate) => candidate.publicSessionId !== activeSession?.publicSessionId)

  const inviteMember = (member: ShareableProjectMember) => {
    if (!activeSession) return
    void run(`invite:${String(member.principalId)}`, async () => {
      const result = await invite({
        sessionId: activeSession._id,
        targetPrincipalId: member.principalId,
        role: sessionRoleFor(member.role),
      })
      return result.duplicate
        ? `${member.displayName} already has an invitation.`
        : `Invited ${member.displayName}. The invitation is in their Inbox.`
    })
  }

  const inviteDevice = () => {
    const targetIdentityKey = identityKey.trim()
    if (!activeSession || !targetIdentityKey) return
    void run("invite:device", async () => {
      const result = await invite({ sessionId: activeSession._id, targetIdentityKey, role: "developer" })
      setIdentityKey("")
      return result.duplicate
        ? "That device already has an invitation."
        : "Invited that device. The invitation is in its Inbox."
    })
  }

  const openSessionWorkbench = (candidate: NonNullable<typeof sessions>[number]) => {
    void run(
      `switch:${candidate.branchName}`,
      async () => {
        await switchToSessionWorkbench({
          sessionId: candidate._id,
          publicSessionId: candidate.publicSessionId,
          branchName: candidate.branchName,
          repositoryUrl: candidate.repositoryUrl,
          viewerMembership: candidate.viewerMembership,
        })
        return `Opened the Session Workbench for ${candidate.branchName}.`
      },
      describeWorkbenchError(candidate.repositoryUrl ?? null),
    )
  }

  const handleLeaveSession = async () => {
    if (!activeSession) return
    if (onLeaveSession) {
      onLeaveSession()
      return
    }
    void run("leave", async () => {
      let retainedBatches = 0
      let retainedBinaryVersions = 0
      try {
        if (window.electronAPI?.projectd?.sessions?.prepareLeave) {
          const prepared = await window.electronAPI.projectd.sessions.prepareLeave(activeSession.publicSessionId)
          if (prepared?.success) {
            retainedBatches = prepared.pendingBatches ?? 0
            retainedBinaryVersions = prepared.pendingBinaryVersions ?? 0
          }
        }
      } catch (err) {
        console.warn("[LiveSessionShareSection] prepareLeave warning:", err)
      }

      await leaveSessionMutation({ sessionId: activeSession._id })

      try {
        if (window.electronAPI?.projectd?.sessions?.detach) {
          await window.electronAPI.projectd.sessions.detach(activeSession.publicSessionId)
        }
      } catch (err) {
        console.warn("[LiveSessionShareSection] detach warning:", err)
      }

      if (retainedBatches > 0 || retainedBinaryVersions > 0) {
        appToast.info({
          title: "Left collaboration",
          description: "Some edits were not confirmed by the session. Their recovery data remains on this Mac.",
        })
      }
      return "Left the live session."
    })
  }

  const handleEndActiveSession = async () => {
    if (!activeSession) return
    void run("end", async () => {
      try {
        if (window.electronAPI?.projectd?.sessions?.close) {
          await window.electronAPI.projectd.sessions.close(activeSession.publicSessionId, {
            reviewId: "direct",
            allowUnpublishedGit: true,
            allowUnresolvedConflicts: true,
          })
        }
      } catch (err) {
        console.warn("[LiveSessionShareSection] daemon close warning:", err)
      }
      await endSessionMutation({ sessionId: activeSession._id, force: true })
      try {
        if (window.electronAPI?.projectd?.sessions?.detach) {
          await window.electronAPI.projectd.sessions.detach(activeSession.publicSessionId)
        }
      } catch (err) {
        console.warn("[LiveSessionShareSection] detach warning:", err)
      }
      appToast.success({
        title: "Collaboration ended",
        description: `Live session on ${activeSession.branchName} has been closed for everyone.`,
      })
      return "Ended the live session."
    })
  }

  let body: ReactNode
  if (sessions === undefined) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>
  } else if (!sync?.gitCwd || !activeBranch) {
    body = (
      <p className="rounded-md border border-border/60 px-3 py-3 text-sm text-muted-foreground">
        Live sessions follow a Git branch. Open a project folder that is a Git repository to start one.
      </p>
    )
  } else if (!activeSession) {
    body = (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
        <p className="min-w-0 text-sm text-muted-foreground">
          Nobody is editing <span className="font-mono text-foreground">{activeBranch}</span> live yet.
        </p>
        <Button size="sm" className="h-8 text-sm shrink-0" disabled={busy !== null} onClick={onStartSession}>
          Start live session
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Live session on <span className="font-mono">{activeSession.branchName}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {inSession.length} {inSession.length === 1 ? "person is" : "people are"} currently collaborating
              {activeSession.lifecycle === "ACTIVE" ? "." : ` (${activeSession.lifecycle.toLowerCase()}).`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {self?.status === "active" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                disabled={busy !== null}
                onClick={handleLeaveSession}
              >
                {busy === "leave" ? <Spinner size="xs" className="mr-1" /> : null}
                Leave
              </Button>
            ) : null}
            {canManageProject ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2.5 text-xs shrink-0"
                disabled={busy !== null}
                onClick={handleEndActiveSession}
              >
                {busy === "end" ? <Spinner size="xs" className="mr-1" /> : null}
                End session
              </Button>
            ) : null}
          </div>
        </div>
        {canInvite && activeSession.accessMode ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {activeSession.accessMode === "invite_only"
                ? "Project session: everyone with access to this project can join."
                : "Organization session: everyone in the project's organization can join."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs shrink-0"
              disabled={busy !== null}
              onClick={() => {
                void run("access", async () => {
                  const next =
                    activeSession.accessMode === "invite_only" ? "organization_available" : "invite_only"
                  await updateAccessMode({ sessionId: activeSession._id, accessMode: next })
                  return next === "organization_available"
                    ? "Session is now open to the whole organization."
                    : "Session is now limited to this project."
                })
              }}
            >
              {busy === "access" ? <Spinner size="xs" className="mr-1" /> : null}
              {activeSession.accessMode === "invite_only" ? "Open to organization" : "Make project-only"}
            </Button>
          </div>
        ) : null}
        {canInvite ? (
          <>
            {invitable.length > 0 ? (
              <div className="space-y-1.5">
                {invitable.map((member) => {
                  const key = `invite:${String(member.principalId)}`
                  return (
                    <div key={String(member.principalId)} className="flex items-center gap-2 px-1 text-sm">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{member.displayName}</span>
                      <span className="text-xs text-muted-foreground">{member.role.replace(/_/g, " ")}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        disabled={busy !== null}
                        onClick={() => inviteMember(member)}
                      >
                        {busy === key ? <Spinner size="xs" className="mr-1" /> : null}
                        Invite
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={identityKey}
                onChange={(event) => setIdentityKey(event.target.value)}
                placeholder="Another device's czd_… ID"
                aria-label="Device ID to invite"
                className="h-9 flex-1 font-mono text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter") inviteDevice()
                }}
              />
              <Button size="sm" className="h-9 text-sm" disabled={!identityKey.trim() || busy !== null} onClick={inviteDevice}>
                Invite
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Only session managers can invite people to the session.</p>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-2" aria-label="Live session">
      <div>
        <p className="text-sm font-medium text-foreground">Live session</p>
        <p className="text-xs text-muted-foreground">
          Everyone in a live session edits the same branch in real time, each from their own Mac.
        </p>
      </div>
      {message ? (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            message.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      ) : null}
      {body}
      {otherSessions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">Other live sessions in this project</p>
          {otherSessions.map((candidate) => (
            <div key={String(candidate._id)} className="flex items-center gap-2 px-1 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{candidate.branchName}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                disabled={busy !== null}
                onClick={() => openSessionWorkbench(candidate)}
              >
                {busy === `switch:${candidate.branchName}` ? <Spinner size="xs" className="mr-1" /> : null}
                Open workbench
              </Button>
              {canManageProject ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={busy !== null}
                  onClick={() => {
                    void run(`end:${candidate.publicSessionId}`, async () => {
                      try {
                        if (window.electronAPI?.projectd?.sessions?.close) {
                          await window.electronAPI.projectd.sessions.close(candidate.publicSessionId, {
                            reviewId: "direct",
                            allowUnpublishedGit: true,
                            allowUnresolvedConflicts: true,
                          })
                        }
                      } catch (err) {
                        console.warn("[LiveSessionShareSection] daemon close warning:", err)
                      }
                      await endSessionMutation({ sessionId: candidate._id, force: true })
                      try {
                        if (window.electronAPI?.projectd?.sessions?.detach) {
                          await window.electronAPI.projectd.sessions.detach(candidate.publicSessionId)
                        }
                      } catch (err) {
                        console.warn("[LiveSessionShareSection] detach warning:", err)
                      }
                      appToast.success({
                        title: "Collaboration ended",
                        description: `Live session on ${candidate.branchName} has been closed.`,
                      })
                      return `Ended session on ${candidate.branchName}.`
                    })
                  }}
                >
                  {busy === `end:${candidate.publicSessionId}` ? <Spinner size="xs" className="mr-1" /> : null}
                  End
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
