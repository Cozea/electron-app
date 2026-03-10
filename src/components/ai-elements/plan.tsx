"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardListIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, memo, useContext, useState } from "react";
import { Loader } from "./loader";
import { Shimmer } from "./shimmer";

/**
 * Status of a plan step
 */
export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | "skipped";

/**
 * Plan step data structure
 */
export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  details?: ReactNode;
}

type PlanContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  steps: PlanStep[];
};

const PlanContext = createContext<PlanContextValue | null>(null);

export const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("Plan components must be used within Plan");
  }
  return context;
};

export type PlanProps = ComponentProps<typeof Collapsible> & {
  /** Whether the plan is being streamed/generated */
  isStreaming?: boolean;
  /** Plan steps */
  steps?: PlanStep[];
};

/**
 * Container for agent plan display with collapsible steps.
 * Shows plan generation progress and allows approval/rejection.
 *
 * @example
 * ```tsx
 * <Plan isStreaming={false} steps={steps}>
 *   <PlanHeader>
 *     <PlanTitle>Implementation Plan</PlanTitle>
 *     <PlanDescription>5 steps to complete the task</PlanDescription>
 *     <PlanTrigger />
 *   </PlanHeader>
 *   <PlanContent>
 *     <PlanSteps />
 *   </PlanContent>
 *   <PlanFooter>
 *     <PlanAction label="Approve" onClick={handleApprove} />
 *     <PlanAction label="Reject" onClick={handleReject} variant="outline" />
 *   </PlanFooter>
 * </Plan>
 * ```
 */
export const Plan = memo(
  ({
    className,
    isStreaming = false,
    steps = [],
    defaultOpen = true,
    children,
    ...props
  }: PlanProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
      <PlanContext.Provider value={{ isStreaming, isOpen, setIsOpen, steps }}>
        <Collapsible
          className={cn(
            "not-prose mb-4 w-full rounded-lg border",
            className
          )}
          open={isOpen}
          onOpenChange={setIsOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </PlanContext.Provider>
    );
  }
);

Plan.displayName = "Plan";

export type PlanHeaderProps = HTMLAttributes<HTMLDivElement>;

/**
 * Header section of the plan containing title, description, and trigger
 */
export const PlanHeader = memo(
  ({ className, children, ...props }: PlanHeaderProps) => (
    <div
      className={cn("flex items-start justify-between gap-4 p-4", className)}
      {...props}
    >
      <div className="flex items-start gap-3">
        <ClipboardListIcon className="mt-0.5 size-5 text-muted-foreground" />
        <div className="space-y-1">{children}</div>
      </div>
    </div>
  )
);

PlanHeader.displayName = "PlanHeader";

export type PlanTitleProps = HTMLAttributes<HTMLHeadingElement>;

/**
 * Title for the plan
 */
export const PlanTitle = memo(
  ({ className, children, ...props }: PlanTitleProps) => {
    const { isStreaming } = usePlan();

    return (
      <h4 className={cn("font-medium text-sm", className)} {...props}>
        {isStreaming && typeof children === "string" ? (
          <Shimmer>{children}</Shimmer>
        ) : (
          children
        )}
      </h4>
    );
  }
);

PlanTitle.displayName = "PlanTitle";

export type PlanDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * Description/summary of the plan
 */
export const PlanDescription = memo(
  ({ className, children, ...props }: PlanDescriptionProps) => (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    >
      {children}
    </p>
  )
);

PlanDescription.displayName = "PlanDescription";

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

/**
 * Trigger to expand/collapse plan content
 */
export const PlanTrigger = memo(
  ({ className, children, ...props }: PlanTriggerProps) => {
    const { isOpen } = usePlan();

    return (
      <CollapsibleTrigger
        className={cn(
          "absolute right-4 top-4 rounded-md p-1 hover:bg-muted",
          className
        )}
        {...props}
      >
        {children ?? (
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        )}
      </CollapsibleTrigger>
    );
  }
);

PlanTrigger.displayName = "PlanTrigger";

export type PlanContentProps = ComponentProps<typeof CollapsibleContent>;

/**
 * Collapsible content area for plan steps
 */
export const PlanContent = memo(
  ({ className, children, ...props }: PlanContentProps) => (
    <CollapsibleContent
      className={cn(
        "border-t px-4 pb-4 pt-2",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
);

PlanContent.displayName = "PlanContent";

export type PlanFooterProps = HTMLAttributes<HTMLDivElement>;

/**
 * Footer section for plan actions (approve/reject buttons)
 */
export const PlanFooter = memo(
  ({ className, children, ...props }: PlanFooterProps) => (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);

PlanFooter.displayName = "PlanFooter";

export type PlanActionProps = ComponentProps<typeof Button> & {
  /** Icon to display before the label */
  icon?: ReactNode;
  /** Button label */
  label: string;
};

/**
 * Action button for plan approval/rejection
 */
export const PlanAction = memo(
  ({
    className,
    icon,
    label,
    size = "sm",
    ...props
  }: PlanActionProps) => (
    <Button className={cn("gap-1.5", className)} size={size} {...props}>
      {icon}
      {label}
    </Button>
  )
);

PlanAction.displayName = "PlanAction";

// Step status icon component
const StepStatusIcon = ({ status }: { status: PlanStepStatus }) => {
  switch (status) {
    case "pending":
      return <CircleIcon className="size-4 text-muted-foreground" />;
    case "in_progress":
      return (
        <Loader className="size-4 text-blue-500" />
      );
    case "completed":
      return <CheckCircleIcon className="size-4 text-green-500" />;
    case "error":
      return <XCircleIcon className="size-4 text-red-500" />;
    case "skipped":
      return (
        <CircleIcon className="size-4 text-muted-foreground/50" />
      );
    default:
      return <CircleIcon className="size-4 text-muted-foreground" />;
  }
};

export type PlanStepsProps = HTMLAttributes<HTMLDivElement>;

/**
 * Renders all plan steps from context
 */
export const PlanSteps = memo(
  ({ className, ...props }: PlanStepsProps) => {
    const { steps, isStreaming } = usePlan();

    if (steps.length === 0 && !isStreaming) {
      return null;
    }

    return (
      <div className={cn("mt-2 space-y-2", className)} {...props}>
        {steps.map((step, index) => (
          <PlanStepItem key={step.id} step={step} index={index} />
        ))}
        {isStreaming && steps.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4" />
            <span>Generating plan</span>
          </div>
        )}
      </div>
    );
  }
);

PlanSteps.displayName = "PlanSteps";

type PlanStepItemProps = {
  step: PlanStep;
  index: number;
};

/**
 * Individual plan step item
 */
const PlanStepItem = memo(({ step, index }: PlanStepItemProps) => (
  <div
    className={cn(
      "flex items-start gap-3 rounded-md p-2",
      step.status === "in_progress" && "bg-blue-500/5",
      step.status === "error" && "bg-red-500/5"
    )}
  >
    <div className="mt-0.5">
      <StepStatusIcon status={step.status} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{index + 1}.</span>
        <span
          className={cn(
            "text-sm",
            step.status === "completed" && "text-muted-foreground line-through",
            step.status === "skipped" && "text-muted-foreground/50"
          )}
        >
          {step.title}
        </span>
      </div>
      {step.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {step.description}
        </p>
      )}
      {step.details && (
        <div className="mt-2 text-xs">{step.details}</div>
      )}
    </div>
  </div>
));

PlanStepItem.displayName = "PlanStepItem";

// Progress indicator component
export type PlanProgressProps = HTMLAttributes<HTMLDivElement>;

/**
 * Shows plan completion progress
 */
export const PlanProgress = memo(
  ({ className, ...props }: PlanProgressProps) => {
    const { steps } = usePlan();

    const completed = steps.filter(
      (s) => s.status === "completed" || s.status === "skipped"
    ).length;
    const total = steps.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <div
        className={cn("text-xs text-muted-foreground", className)}
        {...props}
      >
        {completed}/{total} steps ({percentage}%)
      </div>
    );
  }
);

PlanProgress.displayName = "PlanProgress";
