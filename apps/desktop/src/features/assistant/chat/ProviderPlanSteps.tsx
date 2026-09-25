import { memo } from "react";
import { LuCheck as CheckIcon, LuCircle as CircleIcon, LuListTodo as ListTodoIcon } from "react-icons/lu";
import { LiveShimmerText } from "@/components/ui/live-shimmer-text";
import { cn } from "@/lib/utils";
import type { ActivePlanState } from "./session-logic";

export interface ProviderPlanStepsProps {
  plan: ActivePlanState;
  isActive?: boolean;
}

/** Runtime step plans are distinct from proposed plans requiring user action. */
export const ProviderPlanSteps = memo(function ProviderPlanSteps({
  plan,
  isActive = true,
}: ProviderPlanStepsProps) {
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalCount = plan.steps.length;

  return (
    <section
      aria-label="Agent plan"
      className="my-2.5 rounded-xl border border-border/80 bg-card p-3.5 text-xs shadow-xs text-card-foreground"
    >
      <div className="mb-2.5 flex items-center justify-between border-b border-border/60 pb-2 text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium text-foreground/80">
          <ListTodoIcon className="size-3.5 text-primary" />
          <span>Tasks Plan</span>
        </div>
        <span className="font-mono text-2xs tabular-nums">
          {completedCount} of {totalCount} completed
        </span>
      </div>

      {plan.explanation ? (
        <p className="mb-2 whitespace-pre-wrap text-muted-foreground">{plan.explanation}</p>
      ) : null}

      <ol className="space-y-1.5">
        {plan.steps.map((step, index) => {
          const isDone = step.status === "completed";
          const isInProgress = step.status === "inProgress";

          return (
            <li key={index} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckIcon className="size-3.5 text-success" />
                ) : isInProgress ? (
                  <span className="relative flex size-3.5 items-center justify-center">
                    <span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                ) : (
                  <CircleIcon className="size-3.5 text-muted-foreground/40" />
                )}
              </span>

              {isActive && isInProgress ? (
                <LiveShimmerText className="flex-1 font-medium">{step.step}</LiveShimmerText>
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 whitespace-pre-wrap break-words",
                    isDone ? "text-muted-foreground line-through decoration-muted-foreground/30" : "text-foreground/85",
                  )}
                >
                  {step.step}
                </span>
              )}

              <span
                className={cn(
                  "ml-auto shrink-0 text-2xs font-medium",
                  isDone
                    ? "text-success"
                    : isInProgress
                      ? "text-primary"
                      : "text-muted-foreground/60",
                )}
              >
                {isDone ? "Completed" : isInProgress ? "In progress" : "Pending"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
