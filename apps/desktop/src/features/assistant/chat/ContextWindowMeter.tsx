import { cn } from "@/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../lib/contextWindow";
import {
  type AccountUsageLimitSnapshot,
  type AccountUsageLimitWindow,
  formatUsageLimitReset,
} from "../lib/usageLimits";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  accountUsage?: AccountUsageLimitSnapshot | null;
  hidePercentage?: boolean;
  className?: string;
  children?: React.ReactNode;
  disableTooltip?: boolean;
}) {
  const {
    usage,
    accountUsage = null,
    hidePercentage = false,
    className,
    children,
    disableTooltip = false,
  } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = children ? 14 : 8.25;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  const progressColorClass =
    normalizedPercentage >= 90
      ? "text-rose-500"
      : normalizedPercentage >= 75
        ? "text-amber-500"
        : "text-foreground/80 dark:text-white/80";
  const contextValue =
    usage.maxTokens !== null && usedPercentage
      ? `${usedPercentage} used · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens ?? null)}`
      : `${formatContextWindowTokens(usage.usedTokens)} tokens used`;
  const accountUsageWindows = accountUsage?.windows ?? [];
  const hasAccountUsage = accountUsageWindows.length > 0;
  const accountUsageValue = hasAccountUsage
    ? accountUsageWindows
        .map((window) => `${window.label} ${formatRemainingUsage(window)}`)
        .join(" · ")
    : "Not reported";
  const nextResetWindow = accountUsageWindows
    .filter((window) => window.resetsAt !== null)
    .toSorted((left, right) => String(left.resetsAt).localeCompare(String(right.resetsAt)))[0];
  const nextReset = nextResetWindow ? formatUsageLimitReset(nextResetWindow.resetsAt) : null;

  if (children) {
    const ringContent = (
      <div
        className={cn(
          "group relative inline-flex size-8 shrink-0 items-center justify-center cursor-pointer",
          className,
        )}
        aria-label={`Context window ${contextValue}. AI usage left ${accountUsageValue}`}
      >
        <svg
          viewBox="0 0 32 32"
          className="pointer-events-none -rotate-90 absolute inset-0 h-full w-full transform-gpu"
          aria-hidden="true"
        >
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="text-foreground/15 dark:text-white/10 transition-colors duration-200 group-hover:text-foreground/25 dark:group-hover:text-white/25"
          />
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={cn(
              "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none group-hover:brightness-125",
              progressColorClass,
            )}
          />
        </svg>
        {children}
      </div>
    );

    if (disableTooltip) {
      return ringContent;
    }

    return (
      <Tooltip>
        <TooltipTrigger render={ringContent} />
        <TooltipPopup
          side="top"
          align="end"
          sideOffset={8}
          className="w-[16.5rem] max-w-[calc(100vw-1rem)] p-3 rounded-xl border border-border/60 bg-[var(--assistant-composer-surface)] shadow-2xl text-popover-foreground pointer-events-none dark:border-white/[0.08]"
        >
          <div className="space-y-2 text-xs leading-tight">
            <div
              data-usage-row="context"
              className="flex items-start justify-between gap-4"
            >
              <span className="shrink-0 text-muted-foreground">Context</span>
              <span className="min-w-0 text-right font-medium tabular-nums text-foreground">
                {contextValue}
              </span>
            </div>
            <div
              data-usage-row="account"
              className="flex items-start justify-between gap-4 border-t border-border/60 pt-2"
            >
              <span className="shrink-0 text-muted-foreground">AI usage left</span>
              <span className="min-w-0 text-right tabular-nums">
                <span
                  className={cn(
                    "font-medium",
                    hasAccountUsage ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {accountUsageValue}
                </span>
                {nextReset ? (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {nextResetWindow?.label} {nextReset.toLowerCase()}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-full transition-opacity hover:opacity-85 cursor-pointer",
              className,
            )}
            aria-label={`Context window ${contextValue}. AI usage left ${accountUsageValue}`}
          >
            <span className="relative flex h-5 w-5 items-center justify-center shrink-0">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-foreground/20 dark:text-white/20"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className={cn(
                    "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none",
                    progressColorClass,
                  )}
                />
              </svg>
            </span>
            {!hidePercentage ? (
              <span
                className={cn(
                  "min-w-0 text-[9px] font-medium tabular-nums text-muted-foreground",
                  "leading-none",
                )}
              >
                {usage.usedPercentage !== null
                  ? `${Math.round(usage.usedPercentage)}%`
                  : formatContextWindowTokens(usage.usedTokens)}
              </span>
            ) : null}
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="w-[16.5rem] max-w-[calc(100vw-1rem)] px-3 py-2.5"
      >
        <div className="space-y-2 text-xs leading-tight">
          <div
            data-usage-row="context"
            className="flex items-start justify-between gap-4"
          >
            <span className="shrink-0 text-muted-foreground">Context</span>
            <span className="min-w-0 text-right font-medium tabular-nums text-foreground">
              {contextValue}
            </span>
          </div>
          <div
            data-usage-row="account"
            className="flex items-start justify-between gap-4 border-t border-border/60 pt-2"
          >
            <span className="shrink-0 text-muted-foreground">AI usage left</span>
            <span className="min-w-0 text-right tabular-nums">
              <span
                className={cn(
                  "font-medium",
                  hasAccountUsage ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {accountUsageValue}
              </span>
              {nextReset ? (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {nextResetWindow?.label} {nextReset.toLowerCase()}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function formatRemainingUsage(window: AccountUsageLimitWindow): string {
  if (window.remainingPercentage !== null) {
    return `${Math.round(window.remainingPercentage)}% left`;
  }
  if (window.status === "exhausted") return "limit reached";
  if (window.status === "warning") return "low";
  return "available";
}
