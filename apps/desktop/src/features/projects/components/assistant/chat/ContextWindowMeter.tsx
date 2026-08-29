import { cn } from "@/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../lib/contextWindow";
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
  hidePercentage?: boolean;
  className?: string;
}) {
  const { usage, hidePercentage = false, className } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 8.25;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  const progressColorClass =
    normalizedPercentage >= 90
      ? "text-rose-500"
      : normalizedPercentage >= 75
        ? "text-amber-500"
        : "text-foreground/80";

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
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
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
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Context window
          </div>
          {usage.maxTokens !== null && usedPercentage ? (
            <div className="whitespace-nowrap text-xs font-medium text-foreground">
              <span>{usedPercentage}</span>
              <span className="mx-1">⋅</span>
              <span>{formatContextWindowTokens(usage.usedTokens)}</span>
              <span>/</span>
              <span>{formatContextWindowTokens(usage.maxTokens ?? null)} context used</span>
            </div>
          ) : (
            <div className="text-sm text-foreground">
              {formatContextWindowTokens(usage.usedTokens)} tokens used so far
            </div>
          )}
          {(usage.totalProcessedTokens ?? null) !== null &&
          (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
            <div className="text-xs text-muted-foreground">
              Total processed: {formatContextWindowTokens(usage.totalProcessedTokens ?? null)}{" "}
              tokens
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="text-xs text-muted-foreground">
              {usage.autoCompactThreshold !== null
                ? `Automatically compacts at ${formatContextWindowTokens(usage.autoCompactThreshold ?? null)} tokens.`
                : "Automatically compacts its context when needed."}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
