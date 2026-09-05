import { memo } from "react";
import { LiveShimmerText } from "@/components/ui/live-shimmer-text";
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
  return (
    <section aria-label="Agent plan" className="py-2 text-xs">
      {plan.explanation ? (
        <p className="mb-2 whitespace-pre-wrap text-muted-foreground">{plan.explanation}</p>
      ) : null}
      <ol className="space-y-1">
        {plan.steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="w-4 shrink-0 text-right tabular-nums text-muted-foreground"
            >
              {index + 1}.
            </span>
            {isActive && step.status === "inProgress" ? (
              <LiveShimmerText>{step.step}</LiveShimmerText>
            ) : (
              <span className="min-w-0 whitespace-pre-wrap break-words text-foreground/80">
                {step.step}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {step.status === "inProgress"
                ? "In progress"
                : step.status === "completed"
                  ? "Completed"
                  : "Pending"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
});
