/**
 * Collaborative Session Work & Presence Dashboard.
 *
 * Displays session lifetime metrics, PR tracking, Git commit leader,
 * member contribution breakdown with interactive role editor, activity heatmap,
 * and live team audio controls.
 */

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Folder01Icon as __FolderHugeIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  Mic01Icon,
  MicOff01Icon,
  SquareArrowDownRightIcon as __ExternalLinkHugeIcon,
} from "@hugeicons/core-free-icons"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getUserColor } from "@/components/presence/PresenceAvatarGroup"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { SessionMediaController } from "../media/useSessionMedia"
import { SoundWaveCandles } from "../media/SoundWaveCandles"
import type { LiveSessionRecord } from "../live/useLiveSession"
import type { UseSessionMetricsResult } from "../live/useSessionMetrics"
import { SessionActivityHeatmap } from "./SessionActivityHeatmap"

export interface SessionWorkDashboardProps {
  session: LiveSessionRecord
  metrics: UseSessionMetricsResult
  media?: SessionMediaController
  canManage: boolean
  className?: string
}

const ROLE_OPTIONS = [
  { value: "developer", label: "Developer" },
  { value: "viewer", label: "Viewer" },
  { value: "project_manager", label: "Project Manager" },
] as const

export function SessionWorkDashboard({
  session,
  metrics,
  media,
  canManage,
  className,
}: SessionWorkDashboardProps) {
  const [roleUpdatingPrincipal, setRoleUpdatingPrincipal] = useState<string | null>(null)

  const handleRoleChange = async (
    principalId: string,
    role: "viewer" | "developer" | "project_manager",
  ) => {
    setRoleUpdatingPrincipal(principalId)
    try {
      await metrics.updateMemberRole(principalId, role)
    } finally {
      setRoleUpdatingPrincipal(null)
    }
  }

  const { pullRequest, gitLeader, members } = metrics

  return (
    <div className={cn("space-y-4 text-xs", className)}>
      {/* 1. Pull Request & Target Branch Summary */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <HugeiconsIcon icon={GitBranchIcon} className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-medium text-foreground truncate max-w-[200px]">
                  {session.branchName}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground truncate max-w-[140px]">
                  {session.targetBranch}
                </span>
              </div>
            </div>
          </div>

          {pullRequest ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 shrink-0"
              onClick={() => {
                if (pullRequest.url) window.open(pullRequest.url, "_blank")
              }}
            >
              <HugeiconsIcon
                icon={
                  pullRequest.state === "merged"
                    ? GitMergeIcon
                    : pullRequest.isDraft
                      ? GitPullRequestDraftIcon
                      : GitPullRequestIcon
                }
                className={cn(
                  "size-3.5",
                  pullRequest.state === "merged"
                    ? "text-violet-500"
                    : pullRequest.isDraft
                      ? "text-zinc-400"
                      : "text-emerald-500",
                )}
              />
              <span>PR #{pullRequest.number}</span>
              <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="size-3 text-muted-foreground" />
            </Button>
          ) : (
            <Badge variant="outline" className="text-2xs text-muted-foreground font-normal">
              Direct branch
            </Badge>
          )}
        </div>

        {pullRequest?.title ? (
          <p className="text-2xs text-muted-foreground truncate pl-6">
            {pullRequest.title}
          </p>
        ) : null}

        {/* Ahead / behind status */}
        <div className="flex items-center gap-3 text-2xs text-muted-foreground pl-6">
          {typeof pullRequest?.ahead === "number" ? (
            <span>{pullRequest.ahead} commits ahead</span>
          ) : null}
          {typeof pullRequest?.behind === "number" && pullRequest.behind > 0 ? (
            <span>{pullRequest.behind} commits behind target</span>
          ) : null}
        </div>
      </div>

      {/* 2. Git Committer / AutoGit Leader Card */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500 shrink-0">
            <HugeiconsIcon icon={GitBranchIcon} className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                Git Committer: {gitLeader?.displayName ?? "AutoGit Lease"}
              </span>
              {gitLeader?.isSelf ? (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  Your Mac
                </Badge>
              ) : null}
            </div>
            <p className="text-2xs text-muted-foreground truncate">
              Batches edits from all session members into Git commits on this branch.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Session Activity Heatmap */}
      <SessionActivityHeatmap
        buckets={metrics.activityBuckets}
        totalOperations={metrics.totalOperations}
        totalCheckpoints={metrics.totalCheckpoints}
        sessionDuration={metrics.sessionDurationFormatted}
      />

      {/* 4. Collaborator Breakdown & Role Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            Collaborators ({members.length})
          </span>
          <span className="text-2xs text-muted-foreground">
            {canManage ? "Change roles below" : "Session roles"}
          </span>
        </div>

        <div className="space-y-1.5">
          {members.map((m) => {
            const color = getUserColor(m.principalId)
            const isSpeaking = m.microphoneState === "speaking"
            const isMuted = m.microphoneState === "muted"
            const isUpdating = roleUpdatingPrincipal === m.principalId

            return (
              <div
                key={m.principalId}
                className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-card/60 p-2.5 hover:bg-card/90 transition-colors"
              >
                {/* Member Identity & Audio State */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative">
                    <Avatar className="size-7 border-2 border-background">
                      {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt={m.displayName} /> : null}
                      <AvatarFallback
                        className="text-[11px] font-semibold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {m.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {isSpeaking ? (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500 animate-pulse"
                        title="Speaking"
                      />
                    ) : isMuted ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full border-2 border-background bg-muted">
                        <HugeiconsIcon icon={MicOff01Icon} className="size-1.5 text-muted-foreground" />
                      </span>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate max-w-[130px]">
                        {m.displayName}
                      </span>
                      {m.isSelf ? (
                        <span className="text-2xs text-muted-foreground">(you)</span>
                      ) : null}
                      {m.isCurrentGitCommitter ? (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal text-emerald-500 border-emerald-500/30">
                          Committer
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 text-2xs text-muted-foreground pt-0.5">
                      <span>{m.sessionTimeFormatted}</span>
                      <span>·</span>
                      <span>{m.operationsCount} {m.operationsCount === 1 ? "edit" : "edits"}</span>
                      {typeof m.linesAdded === "number" || typeof m.linesDeleted === "number" ? (
                        <>
                          <span>·</span>
                          <span className="text-emerald-500 font-mono">+{m.linesAdded ?? 0}</span>
                          <span className="text-destructive font-mono">-{m.linesDeleted ?? 0}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Edit Share Progress & Role Selector */}
                <div className="flex items-center gap-3 shrink-0">
                  {/* Share Bar */}
                  <div className="hidden sm:flex flex-col items-end gap-0.5">
                    <span className="text-2xs text-muted-foreground">{m.sharePercentage}%</span>
                    <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(4, m.sharePercentage)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>

                  {/* Role Selector or Badge */}
                  {canManage ? (
                    <div className="relative">
                      {isUpdating ? (
                        <div className="flex h-7 w-28 items-center justify-center">
                          <Spinner size="xs" />
                        </div>
                      ) : (
                        <Select
                          value={m.role}
                          onValueChange={(val) =>
                            handleRoleChange(
                              m.principalId,
                              val as "viewer" | "developer" | "project_manager",
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-28 text-2xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-2xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : (
                    <Badge variant="secondary" className="text-2xs font-normal capitalize">
                      {m.role.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 5. Team Call Audio Controls Footer */}
      {media ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Voice & Call Controls</span>
            {media.isSpeaking ? (
              <span className="text-2xs font-medium text-emerald-500 animate-pulse">
                You are speaking
              </span>
            ) : media.isMuted ? (
              <span className="text-2xs text-muted-foreground">Microphone muted</span>
            ) : (
              <span className="text-2xs text-muted-foreground">Microphone active</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant={media.isMuted ? "outline" : "default"}
                size="sm"
                className="h-8 gap-2 px-3 text-xs"
                onClick={() => void media.toggleMute()}
              >
                <HugeiconsIcon
                  icon={media.isMuted ? MicOff01Icon : Mic01Icon}
                  className="size-4"
                />
                <span>{media.isMuted ? "Unmute" : "Mute"}</span>
              </Button>

              {/* SoundWave visualizer preview */}
              <div className="flex h-8 items-center rounded-md border border-border/40 bg-card/60 px-2.5">
                <SoundWaveCandles
                  analyser={media.analyserNode}
                  isMuted={media.isMuted}
                  isSpeaking={media.isSpeaking}
                />
              </div>
            </div>

            {/* Microphone Selector */}
            {media.audioDevices.length > 0 ? (
              <div className="flex items-center gap-2">
                <Select
                  value={media.selectedDeviceId || (media.audioDevices[0]?.deviceId ?? "")}
                  onValueChange={(id) => void media.selectAudioDevice(id)}
                >
                  <SelectTrigger className="h-8 w-44 text-2xs truncate">
                    <SelectValue placeholder="Microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {media.audioDevices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId} className="text-2xs truncate">
                        {d.label || "Default Microphone"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* Background Audio Toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="bg-audio"
                checked={media.allowBackgroundAudio}
                onCheckedChange={media.setAllowBackgroundAudio}
              />
              <label htmlFor="bg-audio" className="text-2xs text-muted-foreground cursor-pointer">
                Play in background
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
