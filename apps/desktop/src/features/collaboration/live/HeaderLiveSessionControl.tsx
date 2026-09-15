/**
 * Header Live Session Control.
 *
 * Compact, unified collaboration control rendered in the top UnifiedHeader
 * when a live collaboration session is active. Replaces the cluttered secondary
 * session bar, recovers vertical space, and consolidates presence and voice.
 */

import { useEffect, useState } from "react"
import { ArrowDown01Icon, MicOff01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { MdCloud, MdCloudOff } from "react-icons/md"

import { Button } from "@/components/ui/button"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { SoundWaveCandles } from "../media/SoundWaveCandles"
import type { SessionMediaController } from "../media/useSessionMedia"
import { BinaryConflictDialog } from "../ui/BinaryConflictDialog"
import { CloseSessionDialog } from "../ui/CloseSessionDialog"
import { MergeSessionDialog } from "../ui/MergeSessionDialog"
import { RebaseSessionDialog } from "../ui/RebaseSessionDialog"
import { StructuralConflictDialog } from "../ui/StructuralConflictDialog"
import { WorkbenchHeaderBranchControl } from "@/features/workbench/WorkbenchHeaderBranchControl"
import {
  formatSaveAge,
  formatSaveTime,
  type LiveSessionAction,
  type LiveSessionAutoGitView,
  type LiveSessionSyncView,
  type SessionMembership,
} from "./liveSessionModel"
import type { LiveSessionController, LiveSessionRecord } from "./useLiveSession"

function SessionStatusPill({
  sync,
  autoGit,
  session,
  canManage,
  canEdit,
  membership,
  busy,
  busyAction: _busyAction,
  isSaving,
  onSaveNow,
  onRebase,
  onMerge,
  onBinaryConflicts,
  onStructuralConflicts,
  onPause,
  onResume,
  onEnd,
}: {
  sync: LiveSessionSyncView
  autoGit: LiveSessionAutoGitView | null
  session: LiveSessionRecord
  canManage: boolean
  canEdit: boolean
  membership: SessionMembership
  busy: boolean
  busyAction: LiveSessionAction | null
  isSaving: boolean
  onSaveNow: () => void
  onRebase: () => void
  onMerge: () => void
  onBinaryConflicts: () => void
  onStructuralConflicts: () => void
  onPause: () => void
  onResume: () => void
  onEnd: () => void
}) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), 30000)
    return () => window.clearInterval(interval)
  }, [])

  const isActive = sync.tone === "live" || sync.tone === "working"
  const paused = session.lifecycle === "PAUSED" || session.lifecycle === "PAUSING"
  const saveAgeLabel = autoGit?.isSaving
    ? "Saving…"
    : autoGit?.lastSavedAt
      ? formatSaveAge(autoGit.lastSavedAt)
      : autoGit?.label ?? "not saved"

  const handleOpenSessionMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    }

    const items: ContextMenuItem<string>[] = []

    if (membership === "active") {
      items.push({
        id: "save_now",
        label: isSaving ? "Saving changes…" : "Save now",
        enabled: !busy && Boolean(autoGit?.canSave) && !isSaving,
        icon: getNativeMenuIcon("sync"),
      })
      items.push({ id: "sep-git", type: "separator" })
    }

    if (membership === "active" && canEdit && autoGit) {
      items.push({
        id: "rebase",
        label: `Rebase on ${session.targetBranch}…`,
        enabled: !busy,
        icon: getNativeMenuIcon("git-fork"),
      })
      items.push({
        id: "merge",
        label: `Merge into ${session.targetBranch}…`,
        enabled: !busy,
        icon: getNativeMenuIcon("branch"),
      })
      items.push({ id: "sep-merge", type: "separator" })
    }

    if (membership === "active") {
      items.push({
        id: "file_conflicts",
        label: "File version conflicts…",
        enabled: !busy,
      })
      items.push({
        id: "path_conflicts",
        label: "Path conflicts…",
        enabled: !busy,
      })
    }

    if (canManage) {
      if (paused) {
        items.push({ id: "sep-lifecycle", type: "separator" })
        items.push({
          id: "resume",
          label: "Resume session",
          enabled: !busy,
        })
      } else {
        items.push({ id: "sep-lifecycle", type: "separator" })
        items.push({
          id: "pause",
          label: "Pause session",
          enabled: !busy,
        })
      }

      items.push({ id: "sep-end", type: "separator" })
      items.push({
        id: "end",
        label: "End session for everyone",
        destructive: true,
        enabled: !busy,
        icon: getNativeMenuIcon("delete"),
      })
    }

    // Clean duplicate or leading/trailing separators
    const cleanedItems: ContextMenuItem<string>[] = []
    for (const item of items) {
      if (item.type === "separator") {
        if (cleanedItems.length === 0 || cleanedItems[cleanedItems.length - 1].type === "separator") {
          continue
        }
      }
      cleanedItems.push(item)
    }
    if (cleanedItems.length > 0 && cleanedItems[cleanedItems.length - 1].type === "separator") {
      cleanedItems.pop()
    }

    const action = await showDesktopContextMenu(cleanedItems, position)
    if (!action) return

    switch (action) {
      case "save_now":
        onSaveNow()
        break
      case "rebase":
        onRebase()
        break
      case "merge":
        onMerge()
        break
      case "file_conflicts":
        onBinaryConflicts()
        break
      case "path_conflicts":
        onStructuralConflicts()
        break
      case "pause":
        onPause()
        break
      case "resume":
        onResume()
        break
      case "end":
        onEnd()
        break
    }
  }

  return (
    <div
      className="inline-flex h-7 items-center gap-1.5 text-sm font-medium text-foreground shrink-0 titlebar-no-drag"
      aria-label={`Session on ${session.branchName} · merges into ${session.targetBranch}${autoGit?.title ? ` · ${autoGit.title}` : ""}`}
    >
      <WorkbenchHeaderBranchControl
        triggerClassName="h-7 min-h-7 min-w-0 shrink gap-1 rounded-md border-0 bg-transparent px-1 text-sm font-medium text-foreground shadow-none hover:bg-muted/60"
        trailing={null}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors titlebar-no-drag shadow-none border-0"
        aria-label="Collaboration sync and session options"
        aria-haspopup="menu"
        onClick={handleOpenSessionMenu}
        title={
          autoGit?.lastSavedAt
            ? `Automatic Git Checkpoint: Saved at ${formatSaveTime(autoGit.lastSavedAt)} (${formatSaveAge(autoGit.lastSavedAt)} ago). Click for session options.`
            : `${autoGit?.label ?? "Collaboration sync active"}. Click for session options.`
        }
      >
        {isActive ? (
          <MdCloud className="size-4 shrink-0 text-blue-500 dark:text-sky-400" />
        ) : (
          <MdCloudOff className="size-4 shrink-0 text-muted-foreground" />
        )}
        {saveAgeLabel ? (
          <span
            className={cn(
              "truncate text-sm font-medium",
              autoGit?.tone === "attention"
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            {saveAgeLabel}
          </span>
        ) : null}
      </Button>
    </div>
  )
}

function AudioControlPill({ media }: { media: SessionMediaController | null }) {
  if (!media) return null

  const isDenied = media.permissionStatus === "denied"
  const isMuted = media.isMuted
  const isSpeaking = media.isSpeaking

  const handleOpenAudioMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    }

    const items: ContextMenuItem<string>[] = []
    const devices = media.audioDevices ?? []

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

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-5 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded-l-none rounded-r-md border-y-0 border-r-0 border-l border-border/40"
        title="Audio settings"
        aria-label="Select audio input device"
        aria-haspopup="menu"
        onClick={handleOpenAudioMenu}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-2.5" />
      </Button>
    </div>
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
          session={live.session}
          canManage={live.canManage}
          canEdit={live.canEdit}
          membership={live.membership}
          busy={busy}
          busyAction={live.busyAction}
          isSaving={isSaving}
          onSaveNow={live.saveNow}
          onRebase={() => setRebasing(true)}
          onMerge={() => setMerging(true)}
          onBinaryConflicts={() => setReviewingFiles(true)}
          onStructuralConflicts={() => setReviewingPaths(true)}
          onPause={live.pause}
          onResume={live.resume}
          onEnd={live.end}
        />

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
