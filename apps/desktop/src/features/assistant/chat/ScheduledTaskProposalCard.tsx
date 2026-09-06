import { HugeiconsIcon } from "@hugeicons/react"
import { Clock01Icon as __ClockHugeIcon } from "@hugeicons/core-free-icons"

import { memo, useMemo } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useNavigate } from "@/lib/router"
import {
  parseScheduledTaskProposals,
  type ScheduledTaskProposal,
} from "@shared/scheduledTaskProposal"
import { describeRecurrence } from "@shared/scheduledTasks"

const MISSING_LABELS: Record<ScheduledTaskProposal["missing"][number], string> = {
  name: "a name",
  prompt: "what it should do",
  startAt: "a first run time",
}

const START_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** The one line under the title: how often, starting when. */
export function describeProposal(proposal: ScheduledTaskProposal): string {
  const recurrence = describeRecurrence(proposal.recurrence)
  if (proposal.startAt === null) return `${recurrence} · needs a start time`
  return `${recurrence} · from ${START_FORMAT.format(new Date(proposal.startAt))}`
}

/**
 * What the Scheduled Tasks form should open with. The agent's project choice is
 * resolved here because only the tile knows which workspace "current" means.
 */
export function buildPrefillParam(
  proposal: ScheduledTaskProposal,
  currentWorkspaceRoot: string | null,
): string {
  const workspaceRoot =
    proposal.project?.kind === "current"
      ? currentWorkspaceRoot
      : proposal.project?.kind === "path"
        ? proposal.project.workspaceRoot
        : null
  return JSON.stringify({
    name: proposal.name,
    prompt: proposal.prompt,
    provider: proposal.provider,
    model: proposal.model,
    computerUse: proposal.computerUse,
    workspaceRoot,
    startAt: proposal.startAt,
    recurrence: proposal.recurrence,
  })
}

/**
 * An agent asked to schedule something answers with a `cozea-scheduled-task`
 * block. This turns that into the form, filled in and waiting: the person
 * reviews and saves, so nothing starts running unattended on the agent's say-so.
 */
export const ScheduledTaskProposalCard = memo(function ScheduledTaskProposalCard({
  message,
  workspaceRoot,
  isStreaming,
}: {
  message: string | null | undefined
  /** The tile's own project, for a proposal that says "current". */
  workspaceRoot?: string | null
  isStreaming?: boolean
}) {
  const navigate = useNavigate()
  const proposals = useMemo(
    // A block only half written is not an offer yet.
    () => (isStreaming ? [] : parseScheduledTaskProposals(message)),
    [isStreaming, message],
  )

  if (proposals.length === 0) return null

  return (
    <div className="mt-2 space-y-2">
      {proposals.map((proposal, index) => (
        <div
          key={`${proposal.name}:${index}`}
          className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3"
        >
          <HugeiconsIcon
            icon={__ClockHugeIcon}
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {proposal.name || "Scheduled task"}
              </span>
              {proposal.computerUse ? (
                <Badge
                  variant="outline"
                  size="sm"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500"
                >
                  Computer use
                </Badge>
              ) : null}
            </div>
            {proposal.prompt ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">{proposal.prompt}</p>
            ) : null}
            <p className="text-xs tabular-nums text-muted-foreground">
              {describeProposal(proposal)}
            </p>
            {proposal.missing.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Still needs {proposal.missing.map((field) => MISSING_LABELS[field]).join(" and ")}.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            onClick={() => {
              const params = new URLSearchParams({
                view: "schedules",
                draft: buildPrefillParam(proposal, workspaceRoot ?? null),
              })
              navigate(`/projects/skills?${params.toString()}`)
            }}
          >
            Review and schedule
          </Button>
        </div>
      ))}
    </div>
  )
})
