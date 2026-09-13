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
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext"
import { cleanConvexError } from "@/lib/convexError"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
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
}: {
  projectId: Id<"projects">
  projectMembers: readonly ShareableProjectMember[] | undefined
  canManageProject: boolean
  onStartSession: () => void
}) {
  const { principalId } = useAuth()
  const navigate = useViewTransitionNavigate()
  const sync = useOptionalProjectSyncContext()
  const route = useOptionalProjectRouteContext()
  const activeBranch = sync?.activeBranch ?? null
  const workspaceId = sync?.workspaceId ?? null

  const sessions = useQuery(api.collaborationSessions.listByProject, { projectId })
  // The Workbench decides the session; the branch lookup only covers the
  // pre-mount bootstrap and must never decide the open session.
  const activeSession = findWorkspaceSession(sessions, workspaceId) ??
    (workspaceId ? null : activeBranch ? findBranchSession(sessions, activeBranch) : null)
  const sessionMembers = useQuery(
    api.collaborationSessions.listMembers,
    activeSession ? { sessionId: activeSession._id } : "skip",
  )
  const invite = useMutation(api.collaborationSessions.inviteParticipant)

  const [identityKey, setIdentityKey] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: string } | null>(null)

  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key)
    setMessage(null)
    try {
      setMessage({ kind: "notice", text: await work() })
    } catch (caught) {
      setMessage({ kind: "error", text: cleanConvexError(caught, "Could not update the live session.") })
    } finally {
      setBusy(null)
    }
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
    void run(`switch:${candidate.branchName}`, async () => {
      const result = await window.electronAPI.projectd.workbenches.ensureSession({
        projectId: String(projectId),
        publicSessionId: candidate.publicSessionId,
        branchName: candidate.branchName,
        baseBranch: candidate.branchName,
        createBranch: false,
        title: `${route?.projectName ?? "Project"} · ${candidate.branchName}`,
        sourceRepoUrl: candidate.repositoryUrl ?? null,
        sourceWorkspaceId: workspaceId,
        includeDirtyChanges: false,
        setActive: true,
      })
      if (!result.success) throw new Error(result.error)
      navigate(buildProjectPath(String(projectId), "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId: String(projectId),
          projectName: route?.projectName ?? null,
          preferredWorkspaceId: result.workspace.workspaceId,
        }),
      })
      return `Opened the Session Workbench for ${candidate.branchName}.`
    })
  }

  let body: ReactNode
  if (sessions === undefined) {
    body = <p className="text-xs text-muted-foreground">Loading…</p>
  } else if (!sync?.gitCwd || !activeBranch) {
    body = (
      <p className="rounded-md border border-border/60 px-3 py-3 text-xs text-muted-foreground">
        Live sessions follow a Git branch. Open a project folder that is a Git repository to start one.
      </p>
    )
  } else if (!activeSession) {
    body = (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-2.5 py-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          Nobody is editing <span className="font-mono text-foreground">{activeBranch}</span> live yet.
        </p>
        <Button size="sm" className="h-8 shrink-0" disabled={busy !== null} onClick={onStartSession}>
          Start live session
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-2">
        <p className="text-xs">
          {inSession.length} {inSession.length === 1 ? "person is" : "people are"} in the live session on{" "}
          <span className="font-mono">{activeSession.branchName}</span>
          {activeSession.lifecycle === "ACTIVE" ? "." : ` (${activeSession.lifecycle.toLowerCase()}).`}
        </p>
        {canInvite ? (
          <>
            {invitable.length > 0 ? (
              <div className="space-y-1.5">
                {invitable.map((member) => {
                  const key = `invite:${String(member.principalId)}`
                  return (
                    <div key={String(member.principalId)} className="flex items-center gap-2 px-1 text-xs">
                      <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">{member.role.replace(/_/g, " ")}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
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
                className="h-8 flex-1 font-mono text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") inviteDevice()
                }}
              />
              <Button size="sm" className="h-8" disabled={!identityKey.trim() || busy !== null} onClick={inviteDevice}>
                Invite
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">Only session managers can invite people to the session.</p>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-2" aria-label="Live session">
      <div>
        <p className="text-xs font-medium">Live session</p>
        <p className="text-[11px] text-muted-foreground">
          Everyone in a live session edits the same branch in real time, each from their own Mac.
        </p>
      </div>
      {message ? (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-xs",
            message.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      ) : null}
      {body}
      {otherSessions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Other live sessions in this project</p>
          {otherSessions.map((candidate) => (
            <div key={String(candidate._id)} className="flex items-center gap-2 px-1 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{candidate.branchName}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={busy !== null}
                onClick={() => openSessionWorkbench(candidate)}
              >
                {busy === `switch:${candidate.branchName}` ? <Spinner size="xs" className="mr-1" /> : null}
                Open workbench
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
