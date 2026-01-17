"use client";

import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanTrigger,
  PlanContent,
  PlanSteps,
  PlanFooter,
  PlanAction,
  PlanProgress,
  type PlanStep,
  type PlanStepStatus,
} from "@/components/ai-elements/plan";
import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AgentPlanProps {
  /** Plan title */
  title: string;
  /** Plan description */
  description?: string;
  /** Plan steps */
  steps: PlanStep[];
  /** Whether the plan is being streamed/generated */
  isStreaming?: boolean;
  /** Callback when plan is approved */
  onApprove?: () => void;
  /** Callback when plan is rejected */
  onReject?: () => void;
  /** Whether to show approval buttons */
  showActions?: boolean;
  /** Whether the plan is already approved/executed */
  isApproved?: boolean;
  /** Optional className for styling */
  className?: string;
}

/**
 * Displays an agent's execution plan with approval workflow.
 * Shows plan steps, progress, and allows user to approve or reject.
 *
 * @example
 * ```tsx
 * <AgentPlan
 *   title="Implementation Plan"
 *   description="Steps to implement the new feature"
 *   steps={[
 *     { id: '1', title: 'Create component', status: 'completed' },
 *     { id: '2', title: 'Add styling', status: 'in_progress' },
 *     { id: '3', title: 'Write tests', status: 'pending' },
 *   ]}
 *   showActions
 *   onApprove={() => console.log('Approved')}
 *   onReject={() => console.log('Rejected')}
 * />
 * ```
 */
export function AgentPlan({
  title,
  description,
  steps,
  isStreaming = false,
  onApprove,
  onReject,
  showActions = true,
  isApproved,
  className,
}: AgentPlanProps) {
  const stepsCount = steps.length;
  const completedCount = steps.filter(
    (s) => s.status === "completed" || s.status === "skipped"
  ).length;
  const hasErrors = steps.some((s) => s.status === "error");

  // Auto-generate description if not provided
  const displayDescription =
    description ??
    (stepsCount > 0
      ? `${stepsCount} step${stepsCount !== 1 ? "s" : ""} to complete the task`
      : undefined);

  // Determine if actions should be shown
  const shouldShowActions =
    showActions &&
    !isApproved &&
    !isStreaming &&
    !hasErrors &&
    completedCount === 0;

  return (
    <Plan
      isStreaming={isStreaming}
      steps={steps}
      className={cn("relative", className)}
    >
      <PlanHeader>
        <PlanTitle>{title}</PlanTitle>
        {displayDescription && (
          <PlanDescription>{displayDescription}</PlanDescription>
        )}
        <PlanProgress />
      </PlanHeader>
      <PlanTrigger />
      <PlanContent>
        <PlanSteps />
      </PlanContent>
      {shouldShowActions && (onApprove || onReject) && (
        <PlanFooter>
          {onApprove && (
            <PlanAction
              label="Approve"
              onClick={onApprove}
              icon={<CheckIcon className="size-4" />}
            />
          )}
          {onReject && (
            <PlanAction
              label="Reject"
              onClick={onReject}
              variant="outline"
              icon={<XIcon className="size-4" />}
            />
          )}
        </PlanFooter>
      )}
    </Plan>
  );
}

// Re-export types and components for convenience
export {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanTrigger,
  PlanContent,
  PlanSteps,
  PlanFooter,
  PlanAction,
  PlanProgress,
  type PlanStep,
  type PlanStepStatus,
};

export default AgentPlan;
