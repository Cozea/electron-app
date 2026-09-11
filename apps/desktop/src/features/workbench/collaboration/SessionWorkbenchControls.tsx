/**
 * Session Workbench Controls & AutoGit status banner (Section 5.3, 23.2).
 *
 * Master Specification: Section 5.3, 20.1 - 20.3, 22.1, 23.2
 * Phase: P23
 */

import { useState } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface SessionWorkbenchControlsProps {
  sessionBranch: string
  targetBranch?: string
  lifecycle?: string
  isLeader?: boolean
  lastCheckpointOid?: string | null
  rebaseRecommended?: boolean
  rebaseReason?: string | null
  participants?: Array<{ id: string; name: string; isLeader?: boolean }>
  onCheckpointNow?: () => void
  onRebaseFromTarget?: () => void
  onSyncFromGitHub?: () => void
  onToggleMic?: () => void
  isMicMuted?: boolean
}

export function SessionWorkbenchControls({
  sessionBranch,
  targetBranch = "main",
  lifecycle = "ACTIVE",
  isLeader = false,
  lastCheckpointOid,
  rebaseRecommended = false,
  rebaseReason,
  participants = [],
  onCheckpointNow,
  onRebaseFromTarget,
  onSyncFromGitHub,
  onToggleMic,
  isMicMuted = true,
}: SessionWorkbenchControlsProps) {
  const [isCheckpointing, setIsCheckpointing] = useState(false)

  const handleCheckpoint = async () => {
    setIsCheckpointing(true)
    try {
      await onCheckpointNow?.()
    } finally {
      setIsCheckpointing(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-card/60 px-4 py-2 text-xs">
      {/* Rebase Recommendation Banner (Section 20.2) */}
      {rebaseRecommended && (
        <div className="flex items-center justify-between rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-amber-700 dark:text-amber-400">
          <span>
            <strong>Rebase suggested:</strong> {rebaseReason ?? `Target branch '${targetBranch}' has moved.`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRebaseFromTarget}
            className="h-6 text-xs border-amber-500/40 hover:bg-amber-500/20"
          >
            Rebase from {targetBranch}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Session Branch & AutoGit Status */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono text-xs">
            {sessionBranch}
          </Badge>
          <Badge
            variant={lifecycle === "ACTIVE" ? "default" : "outline"}
            className="text-[10px] uppercase tracking-wide"
          >
            {lifecycle}
          </Badge>

          <Badge variant="outline" className="text-[10px]">
            {isLeader ? "AutoGit Leader" : "Follower"}
          </Badge>

          {lastCheckpointOid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono text-muted-foreground text-[10px] cursor-default">
                  Checkpoint: {lastCheckpointOid.slice(0, 7)}
                </span>
              </TooltipTrigger>
              <TooltipContent>Last Git checkpoint commit: {lastCheckpointOid}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Actions & Participants */}
        <div className="flex items-center gap-2">
          {/* Microphone toggle */}
          <Button
            type="button"
            variant={isMicMuted ? "ghost" : "secondary"}
            size="sm"
            onClick={onToggleMic}
            className="h-7 text-xs"
          >
            {isMicMuted ? "Unmute Mic" : "Mute Mic"}
          </Button>

          {/* Sync from GitHub */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSyncFromGitHub}
            className="h-7 text-xs"
          >
            Sync GitHub
          </Button>

          {/* Checkpoint Now */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCheckpoint}
            disabled={isCheckpointing}
            className="h-7 text-xs"
          >
            {isCheckpointing ? "Checkpointing..." : "Checkpoint now"}
          </Button>

          {/* Participant stack */}
          {participants.length > 0 && (
            <div className="flex items-center -space-x-1 pl-2">
              {participants.slice(0, 4).map((p) => (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>
                    <Avatar className="h-6 w-6 border-2 border-background cursor-default">
                      <AvatarFallback className="text-[10px] font-medium">
                        {p.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>{p.name}{p.isLeader ? " (Leader)" : ""}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
