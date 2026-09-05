import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { LiveShimmerText } from "@/components/ui/live-shimmer-text";

interface ToolGroupSummaryProps {
  rowId: string;
  groupId: string;
  summary: string;
  count: number;
  expanded: boolean;
  active: boolean;
  children?: ReactNode;
  animateEntrance: boolean;
  seenRows: Set<string>;
  onToggle: (groupId: string) => void;
}

/** Keep count changes in one measured button, independent of tool-event identity. */
export const ToolGroupSummary = memo(function ToolGroupSummary({
  rowId,
  groupId,
  summary,
  count,
  expanded,
  active,
  children,
  animateEntrance,
  seenRows,
  onToggle,
}: ToolGroupSummaryProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const entranceOwner = useRef<string | null>(null);
  useLayoutEffect(() => {
    const seen = seenRows.has(rowId);
    if (!seen) entranceOwner.current = rowId;
    seenRows.add(rowId);
    const node = buttonRef.current;
    if (
      (seen && entranceOwner.current !== rowId) ||
      !node ||
      !animateEntrance ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      entranceOwner.current = null;
      return;
    }
    node.classList.add("assistant-tool-enter");
    const timer = setTimeout(() => {
      node.classList.remove("assistant-tool-enter");
      entranceOwner.current = null;
    }, 180);
    // StrictMode reconnects this same instance; a recycled row gets a new ref
    // and cannot reclaim an entrance already consumed in the timeline registry.
    return () => {
      clearTimeout(timer);
      node.classList.remove("assistant-tool-enter");
    };
  }, [rowId, seenRows, animateEntrance]);

  return (
    <Collapsible open={expanded} onOpenChange={() => onToggle(groupId)}>
      <CollapsibleTrigger
        ref={buttonRef}
        type="button"
        data-tool-summary-id={rowId}
        className="group/work-toggle flex h-7 w-full min-w-0 items-center gap-2 px-1 text-left transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-label={`${summary} (${count} tool ${count === 1 ? "call" : "calls"})`}
        title={summary}
        data-tool-group-active={active}
      >
        <span className="min-w-0 truncate text-sm font-normal leading-6 tabular-nums text-muted-foreground">
          {active && !expanded ? (
            <LiveShimmerText className="align-middle">{summary}</LiveShimmerText>
          ) : (
            summary
          )}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn(
            "size-3.5 shrink-0 stroke-[2.2] text-muted-foreground/65 transition-[transform,opacity] duration-200 motion-reduce:transition-none",
            expanded
              ? "rotate-180 opacity-100"
              : "opacity-0 group-hover/work-toggle:opacity-100 group-focus-visible/work-toggle:opacity-100",
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsiblePanel className="motion-reduce:transition-none">
        <div className="pl-1 pt-0.5" data-tool-action-list="true">
          {children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
});
