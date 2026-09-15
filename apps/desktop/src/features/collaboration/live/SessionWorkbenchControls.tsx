/**
 * Session bar for the live session on the active branch.
 *
 * Master Specification: Section 5.3, 6.7, 23.2
 * Phase: P23
 *
 * Shows the session's branch, how this folder syncs with it, when the session was
 * last saved to the branch (P16 - P18), how far the branch it merges into has moved
 * (P20), who is in it, and the actions this device may take.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getUserColor } from "@/components/presence/PresenceAvatarGroup"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type {
  LiveSessionAction,
  LiveSessionAutoGitView,
  LiveSessionMember,
  LiveSessionSyncView,
  LiveSessionTargetView,
  SessionMembership,
} from "@/features/collaboration/live/liveSessionModel"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, MicOff01Icon } from "@hugeicons/core-free-icons"
import type { SessionMediaController } from "../media/useSessionMedia"
import { SoundWaveCandles } from "../media/SoundWaveCandles"
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
  /** Whether this device may change the session's files. */
  canEdit?: boolean
  /** How far the branch the session merges into has moved. */
  target?: LiveSessionTargetView | null
  busyAction?: LiveSessionAction | null
  onSaveNow?: () => void
  onIgnoreEnvironmentFiles?: () => void
  onCheckTarget?: () => void
  onDismissTarget?: () => void
  /** Opens the explicit rebase onto the target branch (P21). */
  onRebase?: () => void
  onBinaryConflicts?: () => void
  onStructuralConflicts?: () => void
  /** Opens the merge into the target branch (P22). */
  onMerge?: () => void
  onJoin?: () => void
  onLeave?: () => void
  onPause?: () => void
  onResume?: () => void
  onEnd?: () => void
  media?: SessionMediaController | null
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
  canEdit = false,
  target = null,
  busyAction = null,
  onSaveNow,
  onIgnoreEnvironmentFiles,
  onCheckTarget,
  onDismissTarget,
  onRebase,
  onBinaryConflicts,
  onStructuralConflicts,
  onMerge,
  onJoin,
  onLeave,
  onPause,
  onResume,
  onEnd,
  media = null,
}: SessionWorkbenchControlsProps) {
  const busy = busyAction !== null
  const inSession = members.filter((member) => member.status === "active")
  const paused = lifecycle === "PAUSED" || lifecycle === "PAUSING"
  const canJoin = membership === "none" || membership === "left"
  const spinnerFor = (action: LiveSessionAction) =>
    busyAction === action ? <Spinner size="xs" className="mr-1" /> : null

  const handleOpenAudioMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!media) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    }

    const items: ContextMenuItem<string>[] = []
    const devices = media.audioDevices ?? []
    const isDenied = media.permissionStatus === "denied"

    if (devices.length === 0) {
      items.push({
        id: "no-devices",
        label: isDenied ? "Microphone permission denied" : "No microphones detected",
        enabled: false,
      })
    } else {
      for (const device of devices) {
        const isSelected =
          media.selectedDeviceId === device.deviceId ||
          (!media.selectedDeviceId && device.deviceId === "default") ||
          (!media.selectedDeviceId && devices[0]?.deviceId === device.deviceId)

        items.push({
          id: `device:${device.deviceId}`,
          label: device.label || `Microphone (${device.deviceId.slice(0, 8)})`,
          type: "checkbox",
          checked: isSelected,
        })
      }
    }

    if (isDenied) {
      items.push({ id: "sep-perm", type: "separator" })
      items.push({
        id: "request-perm",
        label: "Request microphone permission…",
        destructive: true,
      })
    }

    const action = await showDesktopContextMenu(items, position)
    if (!action) return

    if (action === "request-perm") {
      void media.requestMicrophonePermission()
    } else if (action.startsWith("device:")) {
      const deviceId = action.slice("device:".length)
      void media.selectAudioDevice?.(deviceId)
    }
  }

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
            <TooltipProvider>
              <div className="flex items-center -space-x-1.5 pr-1">
                {inSession.slice(0, MAX_AVATARS).map((member, index) => {
                  const isSpeaking = member.microphoneState === "speaking"
                  const isMuted = member.microphoneState === "muted"
                  const color = getUserColor(member.principalId)
                  return (
                    <Tooltip key={member.principalId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${member.displayName}${member.isSelf ? " (this device)" : ""}, ${member.role.replace(/_/g, " ")}`}
                          className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20 cursor-default focus:outline-none"
                          style={{ zIndex: Math.min(inSession.length, MAX_AVATARS) - index }}
                        >
                          <Avatar
                            className={cn(
                              "size-6 border-2 border-background rounded-full transition-all",
                              isSpeaking && "ring-2 ring-emerald-500 ring-offset-1 border-emerald-500",
                            )}
                          >
                            {member.avatarUrl ? (
                              <AvatarImage src={member.avatarUrl} alt={member.displayName} />
                            ) : null}
                            <AvatarFallback
                              className="text-[10px] font-medium"
                              style={{ backgroundColor: color, color: "white" }}
                            >
                              {initials(member.displayName)}
                            </AvatarFallback>
                          </Avatar>
                          {isMuted ? (
                            <span
                              className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-background border border-border"
                              title="Microphone muted"
                            >
                              <HugeiconsIcon icon={MicOff01Icon} className="size-1.5 text-muted-foreground" />
                            </span>
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                        <p className="font-medium text-xs">
                          {member.displayName} {member.isSelf && <span className="text-muted-foreground">(this device)</span>}
                        </p>
                        <p className="text-2xs text-muted-foreground capitalize">
                          {member.role.replace(/_/g, " ")} · {isSpeaking ? "Speaking" : isMuted ? "Muted" : "Active"}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
                {inSession.length > MAX_AVATARS ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20 cursor-default focus:outline-none"
                      >
                        <Avatar className="size-6 border-2 border-background bg-muted rounded-full">
                          <AvatarFallback className="text-[10px] font-medium bg-muted text-muted-foreground">
                            +{inSession.length - MAX_AVATARS}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">
                        {inSession.length - MAX_AVATARS} more {inSession.length - MAX_AVATARS === 1 ? "person" : "people"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </TooltipProvider>
          ) : null}

          {membership === "active" && media ? (
            <div className="inline-flex items-center rounded-md border border-border/40 p-0.5 bg-background/50">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-live-session-mic-button
                className={cn(
                  "h-5 px-1.5 text-xs gap-1 rounded-sm",
                  media.isMuted
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-emerald-500 hover:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.12)]",
                  media.permissionStatus === "denied" && "text-destructive hover:text-destructive",
                )}
                onClick={() => {
                  if (media.permissionStatus === "denied") {
                    void media.requestMicrophonePermission()
                  } else {
                    void media.toggleMute()
                  }
                }}
                title={
                  media.permissionStatus === "denied"
                    ? "Microphone permission denied (click to retry)"
                    : media.isMuted
                      ? "Microphone muted (click to unmute)"
                      : "Microphone active (click to mute)"
                }
                aria-label={media.isMuted ? "Unmute microphone" : "Mute microphone"}
              >
                <span
                  className="t-icon-swap size-3.5 shrink-0"
                  data-state={media.isMuted ? "muted" : "recording"}
                >
                  <span className="t-icon flex items-center justify-center" data-icon="muted">
                    <HugeiconsIcon icon={MicOff01Icon} className="size-3.5" />
                  </span>
                  <span className="t-icon flex items-center justify-center" data-icon="recording">
                    <SoundWaveCandles
                      analyser={media.analyserNode}
                      isMuted={media.isMuted}
                      isSpeaking={media.isSpeaking}
                      className={cn(media.isSpeaking && "drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]")}
                    />
                  </span>
                </span>
                {!media.isMuted ? <span>Mic</span> : null}
              </Button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-5 w-4 p-0 text-muted-foreground hover:text-foreground rounded-sm"
                title="Audio input settings"
                aria-label="Select audio input device"
                aria-haspopup="menu"
                onClick={handleOpenAudioMenu}
              >
                <HugeiconsIcon icon={ArrowDown01Icon} className="size-2.5" />
              </Button>
            </div>
          ) : null}

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
          {membership === "active" && onBinaryConflicts && <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onBinaryConflicts}>File versions</Button>}
          {membership === "active" && onStructuralConflicts && <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onStructuralConflicts}>Path conflicts</Button>}
          {membership === "active" && canEdit && autoGit && onRebase ? (
            <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onRebase}>
              Rebase…
            </Button>
          ) : null}
          {membership === "active" && canEdit && autoGit && onMerge ? (
            <Button type="button" size="sm" variant="ghost" className={BAR_BUTTON} disabled={busy} onClick={onMerge}>
              Merge…
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
              onClick={onEnd}
            >
              {spinnerFor("end")}
              End
            </Button>
          ) : null}
        </div>
      </div>

      {sync.detail ? (
        <p className={cn("pb-0.5 pl-4", sync.tone === "attention" ? "text-destructive" : "text-muted-foreground")}>
          {sync.detail}
        </p>
      ) : null}
      {autoGit?.detail ? (
        <div className="flex items-center gap-2 pb-0.5 pl-4">
          <p className={cn("min-w-0", autoGit.tone === "attention" ? "text-destructive" : "text-muted-foreground")}>
            {autoGit.detail}
          </p>
          {autoGit.fix === "ignore_env" && canEdit && membership === "active" && onIgnoreEnvironmentFiles ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(BAR_BUTTON, "shrink-0")}
              disabled={busy}
              onClick={onIgnoreEnvironmentFiles}
            >
              {spinnerFor("ignore_env")}
              Add to .gitignore
            </Button>
          ) : null}
        </div>
      ) : null}
      {target && membership === "active" ? (
        <div className="flex items-center gap-2 pb-0.5 pl-4 text-muted-foreground" title={target.title ?? undefined}>
          <p className={cn("min-w-0 truncate", target.tone === "attention" ? "text-destructive" : undefined)}>
            {target.label}
            {target.detail ? ` · ${target.detail}` : null}
          </p>
          {onCheckTarget ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(BAR_BUTTON, "shrink-0")}
              disabled={busy || target.checking}
              onClick={onCheckTarget}
            >
              {target.checking || busyAction === "check_target" ? <Spinner size="xs" className="mr-1" /> : null}
              Check {targetBranch}
            </Button>
          ) : null}
          {target.recommended && onDismissTarget ? (
            <Button type="button" size="sm" variant="ghost" className={cn(BAR_BUTTON, "shrink-0")} onClick={onDismissTarget}>
              Dismiss
            </Button>
          ) : null}
        </div>
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
