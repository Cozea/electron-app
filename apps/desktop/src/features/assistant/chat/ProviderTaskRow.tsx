import { memo, useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { LiveShimmerText } from "@/components/ui/live-shimmer-text";
import { cn } from "@/lib/utils";
import { groupOwnedActivity, type ProviderTaskActivity } from "./providerActivity";

function NativeDetails({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="h-6 cursor-pointer text-muted-foreground">Native details</summary>
      {open ? (
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all text-[10px]">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}

type OwnedGroup = ReturnType<typeof groupOwnedActivity>[number];
function ownedStatus(group: OwnedGroup) {
  const data = group.latest.payload as Record<string, unknown> | null;
  if (
    group.latest.kind.endsWith(".completed") &&
    ["running", "inProgress", "in_progress"].includes(String(data?.status))
  )
    return group.latest.kind;
  return typeof data?.status === "string" ? data.status : group.latest.kind;
}
function ownedRunning(group: OwnedGroup) {
  const status = ownedStatus(group);
  // A terminal event cannot animate merely because a stale payload says running.
  return (
    !group.latest.kind.endsWith(".completed") &&
    ["running", "inProgress", "in_progress", "tool.started", "task.started"].includes(status)
  );
}
const OwnedActivityRow = memo(function OwnedActivityRow({
  group,
  isActive,
}: {
  group: OwnedGroup;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { latest, events } = group;
  const data = latest.payload as Record<string, unknown> | null;
  const detail = [data?.detail, data?.error]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return (
    <details
      className="min-w-0 text-muted-foreground"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        title={latest.summary}
        className="flex h-6 min-w-0 cursor-pointer items-center gap-2"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn(
            "size-3 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        >
          <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span className="min-w-0 flex-1 truncate">
          {isActive && ownedRunning(group) ? (
            <LiveShimmerText>{latest.summary}</LiveShimmerText>
          ) : (
            latest.summary
          )}
        </span>
        <span className="shrink-0 text-[10px]">{ownedStatus(group)}</span>
      </summary>
      {open ? (
        <div className="pb-2 pl-2">
          <p className="whitespace-pre-wrap break-words">{latest.summary}</p>
          {detail ? (
            <p className="whitespace-pre-wrap break-words text-foreground/80">{detail}</p>
          ) : null}
          <NativeDetails value={events} />
        </div>
      ) : null}
    </details>
  );
});

export interface ProviderTaskRowProps {
  task: ProviderTaskActivity;
  expanded: boolean;
  onToggle: (taskId: string) => void;
  /** Hidden chat and settled turns suppress presentation animation. */
  isActive?: boolean;
}

export const ProviderTaskRow = memo(function ProviderTaskRow({
  task,
  expanded,
  onToggle,
  isActive = true,
}: ProviderTaskRowProps) {
  const running = isActive && ["running", "inProgress", "in_progress"].includes(task.status);
  const title = task.title || "Provider task";
  const ownedGroups = expanded ? groupOwnedActivity(task.activities ?? []) : [];
  const hasRunningOwned = isActive && ownedGroups.some(ownedRunning);
  return (
    <Collapsible
      open={expanded}
      onOpenChange={() => onToggle(task.taskId)}
      className="min-w-0 text-xs"
      data-task-id={task.taskId}
    >
      <CollapsibleTrigger
        type="button"
        aria-expanded={expanded}
        className="flex min-h-7 w-full items-center gap-2 rounded-sm py-1 text-left text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn(
            "size-3 shrink-0 transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        >
          <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {running && !expanded ? (
          <LiveShimmerText>{title}</LiveShimmerText>
        ) : (
          <span className="truncate">{title}</span>
        )}
        <span className="ml-auto shrink-0 text-[10px]">
          {running && expanded && !hasRunningOwned ? (
            <LiveShimmerText>{task.status}</LiveShimmerText>
          ) : (
            task.status
          )}
        </span>
        {task.isBackgrounded ? <span className="shrink-0 text-[10px]">Background</span> : null}
      </CollapsibleTrigger>
      <CollapsiblePanel className="motion-reduce:transition-none">
        <div className="space-y-2 pb-2 pl-5">
          {task.detail ? (
            <p className="whitespace-pre-wrap break-words text-foreground/80">{task.detail}</p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            {Object.entries({
              Task: task.presentationKind ? undefined : task.taskId,
              "Owning agent": task.agentId,
              Parent: task.parentAgentId,
              Role: task.role,
              Model: task.model,
            })
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt>{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
          </dl>
          {expanded && task.activities?.length ? (
            <div className="space-y-1" aria-label="Owned activity">
              {ownedGroups.map((group) => (
                <OwnedActivityRow key={group.id} group={group} isActive={isActive} />
              ))}
            </div>
          ) : null}
          <NativeDetails value={task.payload} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
});
