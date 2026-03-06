"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { LanguageModelUsage } from "ai";
import { type ComponentProps, createContext, useContext } from "react";

// Re-export for convenience
export type { LanguageModelUsage };

const PERCENT_MAX = 100;

type ModelId = string;

type ContextSchema = {
  usedTokens: number;
  maxTokens?: number;
  usage?: LanguageModelUsage;
  modelId?: ModelId;
};

const ContextContext = createContext<ContextSchema | null>(null);

function resolveUsagePercent(usedTokens: number, maxTokens?: number): number {
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return 0;
  }
  const pct = usedTokens / maxTokens;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(1, pct));
}

const useContextValue = () => {
  const context = useContext(ContextContext);

  if (!context) {
    throw new Error("Context components must be used within Context");
  }

  return context;
};

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  ...props
}: ContextProps) => (
  <ContextContext.Provider
    value={{
      usedTokens,
      maxTokens,
      usage,
      modelId,
    }}
  >
    <HoverCard closeDelay={0} openDelay={0} {...props} />
  </ContextContext.Provider>
);

const ContextIcon = ({ size = 16 }: { size?: number }) => {
  const { usedTokens, maxTokens } = useContextValue();
  const radius = size * 0.4;
  const strokeWidth = size * 0.12;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const usedPercent = resolveUsagePercent(usedTokens, maxTokens);
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg
      aria-label="Model context usage"
      height={size}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-20"
      />
      <circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        className="opacity-80"
        style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<"button">;

export const ContextTrigger = ({ children, className, ...props }: ContextTriggerProps) => {
  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <button
          type="button"
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center",
            "text-muted-foreground transition-colors hover:text-foreground",
            className
          )}
          {...props}
        >
          <ContextIcon size={14} />
        </button>
      )}
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
  className,
  ...props
}: ContextContentProps) => (
  <HoverCardContent
    className={cn("min-w-60 divide-y overflow-hidden p-0", className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
  children,
  className,
  ...props
}: ContextContentHeaderProps) => {
  const { usedTokens, maxTokens } = useContextValue();
  const usedPercent = resolveUsagePercent(usedTokens, maxTokens);
  const hasContextWindow = typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0;
  const used = new Intl.NumberFormat("en-US", {
    notation: "compact",
  }).format(usedTokens);
  const total = hasContextWindow
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
      }).format(maxTokens)
    : "—";

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{hasContextWindow ? "Context usage" : "Context limit unavailable"}</p>
            <p className="font-mono text-muted-foreground">
              {used} / {total}
            </p>
          </div>
          {hasContextWindow ? (
            <div className="space-y-2">
              <Progress className="bg-muted" value={usedPercent * PERCENT_MAX} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
  children,
  className,
  ...props
}: ContextContentBodyProps) => (
  <div className={cn("w-full p-3", className)} {...props}>
    {children}
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  children,
  className,
  ...props
}: ContextContentFooterProps) => {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export type ContextInputUsageProps = ComponentProps<"div">;

export const ContextInputUsage = ({
  className,
  children,
  ...props
}: ContextInputUsageProps) => {
  const { usage } = useContextValue();
  const inputTokens = usage?.inputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!inputTokens) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">Input</span>
      <TokensOnly tokens={inputTokens} />
    </div>
  );
};

export type ContextOutputUsageProps = ComponentProps<"div">;

export const ContextOutputUsage = ({
  className,
  children,
  ...props
}: ContextOutputUsageProps) => {
  const { usage } = useContextValue();
  const outputTokens = usage?.outputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!outputTokens) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">Output</span>
      <TokensOnly tokens={outputTokens} />
    </div>
  );
};

export type ContextReasoningUsageProps = ComponentProps<"div">;

export const ContextReasoningUsage = ({
  className,
  children,
  ...props
}: ContextReasoningUsageProps) => {
  const { usage } = useContextValue();
  const reasoningTokens = usage?.reasoningTokens ?? 0;

  if (children) {
    return children;
  }

  if (!reasoningTokens) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">Reasoning</span>
      <TokensOnly tokens={reasoningTokens} />
    </div>
  );
};

export type ContextCacheUsageProps = ComponentProps<"div">;

export const ContextCacheUsage = ({
  className,
  children,
  ...props
}: ContextCacheUsageProps) => {
  const { usage } = useContextValue();
  const cacheTokens = usage?.cachedInputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!cacheTokens) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center justify-between text-xs", className)}
      {...props}
    >
      <span className="text-muted-foreground">Cache</span>
      <TokensOnly tokens={cacheTokens} />
    </div>
  );
};

const TokensOnly = ({ tokens }: { tokens?: number }) => (
  <span>
    {tokens === undefined
      ? "—"
      : new Intl.NumberFormat("en-US", {
          notation: "compact",
        }).format(tokens)}
  </span>
);
