import type { ActivePlanState, LatestProposedPlanState } from "./session-logic";

export interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ComposerTaskStep {
  readonly durationMs?: number;
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

const CHECKLIST_REGEX = /^\s*(?:[-*]|\d+\.)\s+\[([ xX/])\]\s+(.*)$/;

/**
 * Parses markdown checklist items (e.g. `- [x] Step 1`, `- [ ] Step 2`, `- [/] In progress`)
 * into structured `ComposerTaskStep` objects.
 */
export function parseTaskStepsFromMarkdown(
  markdown?: string | null,
): ComposerTaskStep[] | null {
  if (!markdown || typeof markdown !== "string") return null;

  const lines = markdown.split(/\r?\n/);
  const steps: ComposerTaskStep[] = [];

  for (const line of lines) {
    const match = CHECKLIST_REGEX.exec(line);
    if (!match) continue;

    const marker = match[1].toLowerCase();
    const text = match[2].trim();
    if (!text) continue;

    let status: ComposerTaskStep["status"] = "pending";
    if (marker === "x") {
      status = "completed";
    } else if (marker === "/") {
      status = "inProgress";
    }

    steps.push({
      step: text,
      status,
    });
  }

  return steps.length > 0 ? steps : null;
}

/**
 * Derives a summary progress object (current step text, completed count, total count)
 * from a list of steps.
 */
export function deriveComposerTasksProgress(
  steps: readonly ComposerTaskStep[],
): ComposerTasksProgress | null {
  if (steps.length === 0) return null;

  const currentStep =
    steps.find((step) => step.status === "inProgress") ??
    steps.find((step) => step.status === "pending") ??
    steps[steps.length - 1];

  if (!currentStep) return null;

  return {
    step: currentStep.step,
    completedSteps: steps.filter((step) => step.status === "completed").length,
    totalSteps: steps.length,
  };
}

/**
 * Resolves active task progress and steps by checking activePlan activities first,
 * then falling back to parsed markdown checklists from activeProposedPlan.
 */
export function resolveTasksProgressAndSteps(input: {
  activePlan?: ActivePlanState | null;
  activeProposedPlan?: LatestProposedPlanState | null;
  isWorking?: boolean;
}): {
  tasksProgress: ComposerTasksProgress | null;
  taskSteps: readonly ComposerTaskStep[] | null;
} {
  // Priority 1: activePlan from session activities if available
  if (input.activePlan && input.activePlan.steps.length > 0) {
    const steps = input.activePlan.steps;
    const progress = deriveComposerTasksProgress(steps);
    if (progress) {
      return { tasksProgress: progress, taskSteps: steps };
    }
  }

  // Priority 2: parsed markdown from activeProposedPlan
  if (input.activeProposedPlan?.planMarkdown) {
    const parsedSteps = parseTaskStepsFromMarkdown(input.activeProposedPlan.planMarkdown);
    if (parsedSteps && parsedSteps.length > 0) {
      const progress = deriveComposerTasksProgress(parsedSteps);
      if (progress) {
        return { tasksProgress: progress, taskSteps: parsedSteps };
      }
    }
  }

  return { tasksProgress: null, taskSteps: null };
}
