/**
 * Header Live Session Control.
 *
 * Compact, unified collaboration control rendered in the top UnifiedHeader
 * when a live collaboration session is active. Replaces the cluttered secondary
 * session bar, recovers vertical space, and consolidates presence and voice.
 */

import { useState } from "react"
import { ArrowDown01Icon, MicOff01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getUserColor } from "@/components/presence/PresenceAvatarGroup"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { SoundWaveCandles } from "../media/SoundWaveCandles"
import type { AudioInputDeviceInfo, SessionMediaController } from "../media/useSessionMedia"
import { BinaryConflictDialog } from "../ui/BinaryConflictDialog"
import { CloseSessionDialog } from "../ui/CloseSessionDialog"
import { MergeSessionDialog } from "../ui/MergeSessionDialog"
import { RebaseSessionDialog } from "../ui/RebaseSessionDialog"
import { StructuralConflictDialog } from "../ui/StructuralConflictDialog"
import { WorkbenchHeaderBranchControl } from "@/features/workbench/WorkbenchHeaderBranchControl"
import { ProjectSyncIndicator } from "@/features/projects/ui/ProjectSyncIndicator"
import type {
  LiveSessionAction,
  LiveSessionAutoGitView,
  LiveSessionMember,
  LiveSessionSyncView,
  SessionMembership,
} from "./liveSessionModel"
import type { LiveSessionController, LiveSessionRecord } from "./useLiveSession"

const TONE_DOT = {
  live: "bg-emerald-500",
  working: "bg-amber-400 animate-pulse",
  attention: "bg-destructive",
  idle: "bg-muted-foreground",
} as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function SessionStatusPill({
  sync,
  autoGit,
  targetBranch,
  branchName,
}: {
  sync: LiveSessionSyncView
  autoGit: LiveSessionAutoGitView | null
  targetBranch: string
  branchName: string
}) {
  return (
    <div
      className="inline-flex h-7 items-center gap-1 rounded-md border border-border/40 bg-secondary/50 px-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/70 shrink-0"
      aria-label={`Live session on ${branchName} · merges into ${targetBranch}${autoGit?.title ? ` · ${autoGit.title}` : ""}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1.5 cursor-default pl-0.5">
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[sync.tone])} />
            <span className="font-medium text-foreground text-[11px]">Live</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs font-medium">Live Collaboration Session</p>
          <p className="text-2xs text-muted-foreground">{sync.detail || `Live on ${branchName} · merges into ${targetBranch}`}</p>
        </TooltipContent>
      </Tooltip>

      <span className="text-muted-foreground/40 text-[11px]">·</span>

      <WorkbenchHeaderBranchControl
        triggerClassName="h-6 min-h-6 min-w-0 shrink gap-1 rounded-none border-0 bg-transparent px-1 text-[11px] font-normal text-inherit shadow-none hover:bg-transparent hover:text-inherit"
        trailing={
          <ProjectSyncIndicator
            variant="compact"
            inheritPillTextColor
            className="h-3.5 w-3.5 shrink-0 rounded-none bg-transparent shadow-none text-muted-foreground"
          />
        }
      />

      {autoGit ? (
        <>
          <span className="text-muted-foreground/40 text-[11px]">·</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "truncate text-[11px] max-w-[140px] cursor-default pr-0.5",
                  autoGit.tone === "attention" ? "text-destructive" : "text-muted-foreground hover:text-foreground transition-colors",
                )}
              >
                {autoGit.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs font-medium">Automatic Git Checkpoint</p>
              <p className="text-2xs text-muted-foreground">{autoGit.detail || autoGit.title}</p>
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  )
}

function ParticipantAvatars({ members }: { members: LiveSessionMember[] }) {
  const inSession = members.filter((m) => m.status === "active")
  if (inSession.length === 0) return null

  const MAX_AVATARS = 3
  const visible = inSession.slice(0, MAX_AVATARS)
  const overflow = inSession.length - MAX_AVATARS

  return (
    <TooltipProvider>
      <div className="flex items-center -space-x-1.5 px-0.5 shrink-0">
        {visible.map((member, index) => {
          const isSpeaking = member.microphoneState === "speaking"
          const isMuted = member.microphoneState === "muted"
          const color = getUserColor(member.principalId)

          return (
            <Tooltip key={member.principalId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20 cursor-default focus:outline-none"
                  style={{ zIndex: visible.length - index }}
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
        {overflow > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20 cursor-default focus:outline-none"
              >
                <Avatar className="size-6 border-2 border-background bg-muted rounded-full">
                  <AvatarFallback className="text-[10px] font-medium bg-muted text-muted-foreground">
                    +{overflow}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {overflow} more {overflow === 1 ? "person" : "people"}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function AudioControlPill({ media }: { media: SessionMediaController | null }) {
  if (!media) return null

  const isDenied = media.permissionStatus === "denied"
  const isMuted = media.isMuted
  const isSpeaking = media.isSpeaking

  return (
    <div className="inline-flex items-center rounded-md border border-border/50 bg-background/60 shadow-xs shrink-0">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-live-session-mic-button
        className={cn(
          "h-7 px-2 text-xs gap-1.5 rounded-l-md rounded-r-none border-0 font-normal transition-colors",
          isDenied
            ? "text-destructive hover:bg-destructive/10"
            : isMuted
              ? "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              : "text-emerald-500 hover:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 font-medium shadow-[0_0_8px_rgba(16,185,129,0.15)]",
        )}
        onClick={() => {
          if (isDenied) {
            void media.requestMicrophonePermission()
          } else {
            void media.toggleMute()
          }
        }}
        title={
          isDenied
            ? "Microphone permission denied (click to retry)"
            : isMuted
              ? "Microphone muted (click to unmute)"
              : "Microphone active (click to mute)"
        }
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
      >
        {isMuted ? (
          <HugeiconsIcon icon={MicOff01Icon} className="size-3.5 text-muted-foreground" />
        ) : (
          <SoundWaveCandles
            analyser={media.analyserNode}
            isMuted={media.isMuted}
            isSpeaking={isSpeaking}
            className={cn(isSpeaking && "drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]")}
          />
        )}
        <span className="text-[11px] leading-none">{isDenied ? "Mic error" : isMuted ? "Muted" : "Voice"}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-5 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded-l-none rounded-r-md border-l border-border/40"
            title="Audio settings"
            aria-label="Select audio input device"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-2.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 text-xs z-50">
          <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground px-2 py-1">
            Microphone
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(media.audioDevices ?? []).length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
              {isDenied
                ? "Microphone permission denied"
                : "No microphones detected"}
            </div>
          ) : (
            (media.audioDevices ?? []).map((device: AudioInputDeviceInfo) => {
              const isSelected =
                media.selectedDeviceId === device.deviceId ||
                (!media.selectedDeviceId && device.deviceId === "default") ||
                (!media.selectedDeviceId && (media.audioDevices ?? [])[0]?.deviceId === device.deviceId)
              return (
                <DropdownMenuCheckboxItem
                  key={device.deviceId}
                  checked={isSelected}
                  className="cursor-pointer text-xs"
                  onClick={() => void media.selectAudioDevice?.(device.deviceId)}
                >
                  <span className="truncate">{device.label}</span>
                </DropdownMenuCheckboxItem>
              )
            })
          )}
          {isDenied ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-destructive cursor-pointer"
                onClick={() => void media.requestMicrophonePermission()}
              >
                Request Microphone Permission
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SessionOptionsMenu({
  session,
  canManage,
  canEdit,
  autoGit,
  membership,
  busy,
  busyAction,
  onRebase,
  onMerge,
  onBinaryConflicts,
  onStructuralConflicts,
  onPause,
  onResume,
  onLeave,
  onEnd,
}: {
  session: LiveSessionRecord
  canManage: boolean
  canEdit: boolean
  autoGit: LiveSessionAutoGitView | null
  membership: SessionMembership
  busy: boolean
  busyAction: LiveSessionAction | null
  onRebase: () => void
  onMerge: () => void
  onBinaryConflicts: () => void
  onStructuralConflicts: () => void
  onPause: () => void
  onResume: () => void
  onLeave: () => void
  onEnd: () => void
}) {
  const paused = session.lifecycle === "PAUSED" || session.lifecycle === "PAUSING"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-md shrink-0"
          title="Live session options"
          aria-label="Live session options"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs z-50">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground px-2 py-1">
          Session Options
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {membership === "active" && canEdit && autoGit ? (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onRebase}
            >
              Rebase on {session.targetBranch}…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onMerge}
            >
              Merge into {session.targetBranch}…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {membership === "active" ? (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onBinaryConflicts}
            >
              File version conflicts…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onStructuralConflicts}
            >
              Path conflicts…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {canManage ? (
          paused ? (
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onResume}
            >
              {busyAction === "resume" ? <Spinner size="xs" className="mr-1.5" /> : null}
              Resume session
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="cursor-pointer text-xs"
              disabled={busy}
              onClick={onPause}
            >
              {busyAction === "pause" ? <Spinner size="xs" className="mr-1.5" /> : null}
              Pause session
            </DropdownMenuItem>
          )
        ) : null}

        {membership === "active" ? (
          <DropdownMenuItem
            className="cursor-pointer text-xs"
            disabled={busy}
            onClick={onLeave}
          >
            {busyAction === "leave" ? <Spinner size="xs" className="mr-1.5" /> : null}
            Leave session
          </DropdownMenuItem>
        ) : null}

        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
              disabled={busy}
              onClick={onEnd}
            >
              {busyAction === "end" ? <Spinner size="xs" className="mr-1.5" /> : null}
              End session for everyone
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function HeaderLiveSessionControl({ live }: { live: LiveSessionController }) {
  const [merging, setMerging] = useState(false)
  const [rebasing, setRebasing] = useState(false)
  const [reviewingFiles, setReviewingFiles] = useState(false)
  const [reviewingPaths, setReviewingPaths] = useState(false)

  if (!live.session || !live.sync) {
    return null
  }

  const busy = live.busyAction !== null
  const canJoin = live.membership === "none" || live.membership === "left"
  const isSaving = live.busyAction === "save" || (live.autoGit?.tone === "working" && live.autoGit.label.startsWith("Saving"))

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0 titlebar-no-drag" data-header-live-session="">
        <SessionStatusPill
          sync={live.sync}
          autoGit={live.autoGit}
          targetBranch={live.session.targetBranch}
          branchName={live.session.branchName}
        />

        <ParticipantAvatars members={live.members} />

        {live.membership === "active" ? <AudioControlPill media={live.media} /> : null}

        {canJoin ? (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs font-medium rounded-md shrink-0"
            disabled={busy}
            onClick={live.join}
          >
            {live.busyAction === "join" ? <Spinner size="xs" className="mr-1" /> : null}
            {live.membership === "left" ? "Rejoin" : "Join session"}
          </Button>
        ) : null}

        {live.membership === "active" && live.autoGit?.canSave ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px] font-normal gap-1 rounded-md border-border/60 bg-background/50 hover:bg-accent/60 shrink-0"
            disabled={busy}
            onClick={live.saveNow}
            title="Save changes to Git now"
          >
            {isSaving ? (
              <Spinner size="xs" className="size-3" />
            ) : null}
            Save now
          </Button>
        ) : null}

        <SessionOptionsMenu
          session={live.session}
          canManage={live.canManage}
          canEdit={live.canEdit}
          autoGit={live.autoGit}
          membership={live.membership}
          busy={busy}
          busyAction={live.busyAction}
          onRebase={() => setRebasing(true)}
          onMerge={() => setMerging(true)}
          onBinaryConflicts={() => setReviewingFiles(true)}
          onStructuralConflicts={() => setReviewingPaths(true)}
          onPause={live.pause}
          onResume={live.resume}
          onLeave={live.leave}
          onEnd={live.end}
        />
      </div>

      {reviewingFiles && (
        <BinaryConflictDialog
          key={live.session.publicSessionId}
          publicSessionId={live.session.publicSessionId}
          canEdit={live.canEdit}
          onClose={() => setReviewingFiles(false)}
        />
      )}

      {reviewingPaths && (
        <StructuralConflictDialog
          key={live.session.publicSessionId}
          publicSessionId={live.session.publicSessionId}
          canEdit={live.canEdit}
          onClose={() => setReviewingPaths(false)}
        />
      )}

      <RebaseSessionDialog
        isOpen={rebasing}
        onOpenChange={setRebasing}
        publicSessionId={live.session.publicSessionId}
        branchName={live.session.branchName}
        targetBranch={live.session.targetBranch}
      />

      {live.closeReview && (
        <CloseSessionDialog
          key={live.closeReview.reviewId}
          review={live.closeReview}
          busy={live.busyAction === "end"}
          onCancel={live.cancelClose}
          onConfirm={live.confirmClose}
        />
      )}

      <MergeSessionDialog
        isOpen={merging}
        onOpenChange={setMerging}
        publicSessionId={live.session.publicSessionId}
        branchName={live.session.branchName}
        targetBranch={live.session.targetBranch}
        canManage={live.canManage}
        onPause={live.pause}
        onEnd={() => {
          setMerging(false)
          live.end()
        }}
      />
    </>
  )
}
