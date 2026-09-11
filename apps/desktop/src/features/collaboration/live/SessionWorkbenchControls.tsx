/**
 * Session bar for the live session on the active branch.
 *
 * Master Specification: Section 5.3, 6.7, 23.2
 * Phase: P23
 *
 * Shows the session's branch, how this folder syncs with it, when the session was
 * last saved to the branch (P16 - P18), who is in it, and the actions this device
 * may take. The microphone joins the bar with P25.
 */

import { useState } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type {
  LiveSessionAction,
  LiveSessionAutoGitView,
  LiveSessionMember,
  LiveSessionSyncView,
  SessionMembership,
} from "@/features/collaboration/live/liveSessionModel"
import { cn } from "@/lib/utils"

const TONE_DOT: Record<LiveSessionSyncView["tone"], string> = {
  live: "bg-emerald-500",
  working: "bg-amber-500 motion-safe:animate-pulse",
  attention: "bg-destructive",
  idle: "bg-muted-foreground/40",
}

const MAX_AVATARS = 4
const BAR_BUTTON = "h-6 px-2 text-xs"

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

export interface SessionWorkbenchControlsProps {
  branchName: string
  targetBranch: string
  lifecycle: string
  sync: LiveSessionSyncView
  /** How the session is saved to its branch; null outside a Git repository or before the folder syncs. */
  autoGit?: LiveSessionAutoGitView | null
  members: readonly LiveSessionMember[]
  membership: SessionMembership
  canManage: boolean
  busyAction?: LiveSessionAction | null
  onSaveNow?: () => void
  onJoin?: () => void
  onLeave?: () => void
  onPause?: () => void
  onResume?: () => void
  onEnd?: () => void
}

export function SessionWorkbenchControls({
  branchName,
  targetBranch,
  lifecycle,
  sync,
  autoGit = null,
  members,
  membership,
  canManage,
  busyAction = null,
  onSaveNow,
  onJoin,
  onLeave,
  onPause,
  onResume,
  onEnd,
}: SessionWorkbenchControlsProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const busy = busyAction !== null
  const inSession = members.filter((member) => member.status === "active")
  const paused = lifecycle === "PAUSED" || lifecycle === "PAUSING"
  const canJoin = membership === "none" || membership === "left"
  const spinnerFor = (action: LiveSessionAction) =>
    busyAction === action ? <Spinner size="xs" className="mr-1" /> : null

  return (
    <div
      role="region"
      aria-label="Live session"
      data-live-session-bar=""
      className="shrink-0 border-b border-border bg-card/60 px-4 py-1.5 text-xs"
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[sync.tone])} />
          <span className="shrink-0 font-medium text-foreground">Live session</span>
          <span className="min-w-0 truncate font-mono text-muted-foreground" title={`Merges into ${targetBranch}`}>
            {branchName}
          </span>
          <span className="shrink-0 text-muted-foreground" role="status">
            {sync.label}
          </span>
          {autoGit ? (
            <span
              className={cn("min-w-0 truncate", autoGit.tone === "attention" ? "text-destructive" : "text-muted-foreground")}
              title={autoGit.title ?? undefined}
            >
              · {autoGit.label}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {inSession.length > 0 ? (
            <div className="flex items-center -space-x-1 pr-1">
              {inSession.slice(0, MAX_AVATARS).map((member) => {
                const label = `${member.displayName}${member.isSelf ? " (this device)" : ""}, ${member.role.replace(/_/g, " ")}`
                return (
                  <Avatar
                    key={member.principalId}
                    className="size-6 border-2 border-background"
                    title={label}
                    aria-label={label}
                  >
                    <AvatarFallback className="text-[10px] font-medium">{initials(member.displayName)}</AvatarFallback>
                  </Avatar>
                )
              })}
              {inSession.length > MAX_AVATARS ? (
                <span className="pl-2 text-muted-foreground">+{inSession.length - MAX_AVATARS}</span>
              ) : null}
            </div>
          ) : null}

          {confirmingEnd ? (
            <>
              <span className="text-muted-foreground">End the session for everyone?</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className={BAR_BUTTON}
                disabled={busy}
                onClick={() => {
                  setConfirmingEnd(false)
                  onEnd?.()
                }}
              >
                End session
              </Button>
              <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} onClick={() => setConfirmingEnd(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canJoin && onJoin ? (
                <Button type="button" size="sm" className={BAR_BUTTON} disabled={busy} onClick={onJoin}>
                  {spinnerFor("join")}
                  {membership === "left" ? "Rejoin" : "Join session"}
                </Button>
              ) : null}
              {membership === "active" && autoGit?.canSave && onSaveNow ? (
                <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onSaveNow}>
                  {spinnerFor("save")}
                  Save now
                </Button>
              ) : null}
              {canManage && paused && onResume ? (
                <Button type="button" size="sm" variant="outline" className={BAR_BUTTON} disabled={busy} onClick={onResume}>
                  {spinnerFor("resume")}
                  Resume
                </Button>
              ) : null}
              {canManage && !paused && onPause ? (
                <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onPause}>
                  {spinnerFor("pause")}
                  Pause
                </Button>
              ) : null}
              {membership === "active" && onLeave ? (
                <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onLeave}>
                  {spinnerFor("leave")}
                  Leave
                </Button>
              ) : null}
              {canManage && onEnd ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(BAR_BUTTON, "text-destructive hover:text-destructive")}
                  disabled={busy}
                  onClick={() => setConfirmingEnd(true)}
                >
                  {spinnerFor("end")}
                  End
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {sync.detail ? (
        <p className={cn("pb-0.5 pl-4", sync.tone === "attention" ? "text-destructive" : "text-muted-foreground")}>
          {sync.detail}
        </p>
      ) : null}
      {autoGit?.detail ? (
        <p className={cn("pb-0.5 pl-4", autoGit.tone === "attention" ? "text-destructive" : "text-muted-foreground")}>
          {autoGit.detail}
        </p>
      ) : null}
    </div>
  )
}

/** Points a member at their live session when the folder has another branch checked out. */
export function SessionBranchNotice({
  branchName,
  busy = false,
  onSwitch,
}: {
  branchName: string
  busy?: boolean
  onSwitch: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Live session"
      data-live-session-bar=""
      className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-1.5 text-xs"
    >
      <p className="min-w-0 truncate text-muted-foreground">
        You&apos;re in the live session on <span className="font-mono text-foreground">{branchName}</span>. Switch to that
        branch to sync with it.
      </p>
      <Button type="button" size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" disabled={busy} onClick={onSwitch}>
        {busy ? <Spinner size="xs" className="mr-1" /> : null}
        Switch branch
      </Button>
    </div>
  )
}
