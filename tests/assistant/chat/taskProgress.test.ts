import { describe, expect, it } from "vitest";
import type { TurnId } from "@cozea/assistant-contracts";

import {
  parseTaskStepsFromMarkdown,
  deriveComposerTasksProgress,
  resolveTasksProgressAndSteps,
} from "@/features/assistant/chat/taskProgress";

describe("taskProgress", () => {
  it("parses task steps from markdown checklist", () => {
    const md = `
# Implementation Plan
- [x] Step 1: Initialize repository
- [/] Step 2: Implement core features
- [ ] Step 3: Write tests and verify
`;
    const steps = parseTaskStepsFromMarkdown(md);
    expect(steps).toHaveLength(3);
    expect(steps![0]).toEqual({ step: "Step 1: Initialize repository", status: "completed" });
    expect(steps![1]).toEqual({ step: "Step 2: Implement core features", status: "inProgress" });
    expect(steps![2]).toEqual({ step: "Step 3: Write tests and verify", status: "pending" });
  });

  it("derives composer tasks progress accurately", () => {
    const steps = [
      { step: "Task 1", status: "completed" as const },
      { step: "Task 2", status: "inProgress" as const },
      { step: "Task 3", status: "pending" as const },
    ];
    const progress = deriveComposerTasksProgress(steps);
    expect(progress).toEqual({
      step: "Task 2",
      completedSteps: 1,
      totalSteps: 3,
    });
  });

  it("resolves tasks progress prioritizing activePlan over activeProposedPlan", () => {
    const result = resolveTasksProgressAndSteps({
      activePlan: {
        createdAt: "2026-09-16T00:00:00.000Z",
        turnId: "turn-1" as TurnId,
        steps: [
          { step: "Activity plan 1", status: "completed" },
          { step: "Activity plan 2", status: "inProgress" },
        ],
      },
      activeProposedPlan: {
        turnId: "turn-1",
        proposedPlan: {
          planMarkdown: "- [ ] Markdown plan",
        },
      } as any,
      isWorking: true,
    });

    expect(result.tasksProgress?.totalSteps).toBe(2);
    expect(result.tasksProgress?.completedSteps).toBe(1);
    expect(result.tasksProgress?.step).toBe("Activity plan 2");
  });

  it("falls back to markdown plan when activePlan has no steps", () => {
    const result = resolveTasksProgressAndSteps({
      activePlan: null,
      activeProposedPlan: {
        id: "plan-1" as any,
        createdAt: "2026-09-15T00:00:00Z",
        updatedAt: "2026-09-15T00:00:00Z",
        turnId: "turn-1" as any,
        planMarkdown: "- [x] Done item\n- [ ] Pending item",
        implementedAt: null,
        implementationThreadId: null,
      },
      isWorking: true,
    });

    expect(result.tasksProgress?.totalSteps).toBe(2);
    expect(result.tasksProgress?.completedSteps).toBe(1);
    expect(result.tasksProgress?.step).toBe("Pending item");
  });
});
