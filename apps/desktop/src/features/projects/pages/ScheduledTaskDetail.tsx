import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert01Icon as __AlertHugeIcon,
  CalendarBlock01Icon as __SkippedHugeIcon,
  InformationCircleIcon as __InfoHugeIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as React from "react";

import { EmptyTaskRuns } from "@/features/projects/pages/EmptyTaskRuns";
import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskRunStatus } from "@shared/scheduledTasks";

const RUN_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const HISTORY_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const HISTORY_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const HISTORY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * "Yesterday at 7:28 AM". Recent runs are the ones people reason about, so the
 * last two days get named rather than dated, and the year only appears once it
 * stops being obvious.
 */
export function formatHistoryTime(value: number, now: number = Date.now()): string {
  const time = HISTORY_TIME_FORMAT.format(new Date(value));
  const days = Math.round((startOfDay(now) - startOfDay(value)) / 86_400_000);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  // Future days matter for a first run, which is named before it exists.
  if (days === -1) return `Tomorrow at ${time}`;
  const sameYear = new Date(value).getFullYear() === new Date(now).getFullYear();
  const day = (sameYear ? HISTORY_DAY_FORMAT : HISTORY_YEAR_FORMAT).format(new Date(value));
  return `${day} at ${time}`;
}

/** What each attempt means, said the way the runner actually knows it. */
export const RUN_STATUS_COPY: Record<
  ScheduledTaskRunStatus,
  { label: string; detail: string; tone: "ok" | "error" | "muted" }
> = {
  started: {
    label: "Started",
    detail: "The run opened a conversation. Its output lives in that conversation.",
    tone: "ok",
  },
  failed: {
    label: "Did not start",
    detail: "Cozea could not start this run.",
    tone: "error",
  },
  skipped: {
    label: "Skipped",
    detail: "The slot passed while Cozea was closed, so it was not replayed.",
    tone: "muted",
  },
};

function RunStatusBadge({ status }: { status: ScheduledTaskRunStatus }) {
  const copy = RUN_STATUS_COPY[status];
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(
        copy.tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        copy.tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        copy.tone === "muted" && "text-muted-foreground",
      )}
    >
      {copy.label}
    </Badge>
  );
}

/**
 * The outcome at a glance: a dot for a run that started, a named row for one
 * that was skipped, a warning for one that could not start. The reason rides
 * on the icon rather than taking a line of its own.
 */
function RunMark({ run }: { run: ScheduledTaskRun }) {
  if (run.status === "started") {
    // Nothing to say about a run that started and has been read; the dot is
    // there to point at the ones still waiting for you.
    if (run.seenAt !== null) return null;
    return (
      <span
        aria-label="Unread"
        title="Unread"
        className="size-2 shrink-0 rounded-full bg-blue-500"
      />
    );
  }

  const isSkipped = run.status === "skipped";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-sm",
            isSkipped ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500",
          )}
        >
          {isSkipped ? (
            <>
              <HugeiconsIcon icon={__SkippedHugeIcon} className="size-4" aria-hidden />
              Skipped
              <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5 opacity-70" aria-hidden />
            </>
          ) : (
            <HugeiconsIcon
              icon={__AlertHugeIcon}
              className="size-4"
              aria-label={RUN_STATUS_COPY.failed.label}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {run.error ?? RUN_STATUS_COPY[run.status].detail}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One task, opened.
 *
 * The results of a run and the list of runs scroll independently: reading a
 * long result must not drag the history out of view, and vice versa.
 */
export function ScheduledTaskDetail({
  task,
  summary,
  selectedRunId,
  onSelectRun,
  onRunOpened,
}: {
  task: ScheduledTask;
  /** Cadence and next run, or "Paused", phrased as the list phrases it. */
  summary: string;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  /** Called once for a run the first time it is shown, to clear its dot. */
  onRunOpened?: (runId: string) => void;
}) {
  const runs = task.runs;
  const selectedRun: ScheduledTaskRun | null =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  // Showing a run is what counts as opening it, including the latest one the
  // page lands on. Already-read runs are left alone, so this settles.
  const unreadRunId = selectedRun && selectedRun.seenAt === null ? selectedRun.id : null;
  React.useEffect(() => {
    if (unreadRunId) onRunOpened?.(unreadRunId);
  }, [onRunOpened, unreadRunId]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Results: its own scroll container. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <p
          className={cn(
            "sticky top-0 z-10 -mx-6 bg-background/85 px-6 py-3 text-sm tabular-nums backdrop-blur",
            task.enabled ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500",
          )}
        >
          {task.enabled ? summary : `${summary} · resumes only when you start it again`}
        </p>
        {selectedRun ? (
          <div className="mx-auto max-w-[640px] space-y-6 py-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={selectedRun.status} />
                <span className="text-sm tabular-nums text-muted-foreground">
                  {RUN_TIME_FORMAT.format(new Date(selectedRun.ranAt))}
                </span>
                {selectedRun.id === runs[0]?.id ? (
                  <Badge variant="secondary" size="sm">
                    Latest
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {RUN_STATUS_COPY[selectedRun.status].detail}
              </p>
            </div>

            {selectedRun.error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs leading-relaxed text-destructive">{selectedRun.error}</p>
              </div>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What it was asked to do
              </h3>
              <p className="rounded-xl border border-border/60 bg-card/40 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {task.prompt}
              </p>
            </section>

            {selectedRun.threadId ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Conversation
                </h3>
                <p className="text-sm text-muted-foreground">
                  This run opened its own chat, which holds everything it produced. Find it in
                  chat history under this task's name.
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground/70">
                  {selectedRun.threadId}
                </p>
              </section>
            ) : null}
          </div>
        ) : (
          // Centred in the pane rather than pinned to the top of it, which is
          // where a scroll container would otherwise leave it.
          <div className="flex min-h-full items-center justify-center py-6">
            <EmptyTaskRuns />
          </div>
        )}
      </div>

      {/* History: scrolls on its own, so a long result never moves it. */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-border/60 md:flex">
        <div className="shrink-0 px-4 pt-4 pb-2">
          <h2 className="text-sm text-muted-foreground">History</h2>
          {/* The runner lives in the app. A slot that passes while Cozea is
              closed is recorded as skipped the next time it opens, so an empty
              history should not be read as a run that vanished. */}
          <p className="mt-1 text-xs text-muted-foreground/70">
            Runs happen while Cozea is open. A slot missed while it was closed is marked skipped
            when you next open it.
          </p>
        </div>
        {runs.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing has run yet.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto pb-4">
            {runs.map((run) => {
              const isSelected = run.id === (selectedRun?.id ?? null);
              return (
                <li key={run.id} className="border-t border-border/50 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => onSelectRun(run.id)}
                    aria-current={isSelected}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors",
                      isSelected ? "bg-muted/60" : "hover:bg-muted/30",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {formatHistoryTime(run.ranAt)}
                    </span>
                    <RunMark run={run} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
