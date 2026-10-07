import { describe, expect, it } from "vitest";
import {
  canApplyWorkbenchIntentToScope,
  markWorkbenchIntentApplied,
  wasWorkbenchIntentApplied,
  type WorkbenchIntent,
} from "@/features/workbench/model/workbenchIntent";

describe("workbench navigation intent ownership", () => {
  it("leaves an imported project's intent pending while the retained surface owns the previous project", () => {
    const intent: WorkbenchIntent = { openTile: "assistantChat" };
    const target = { targetProjectId: "lpj_new", targetWorkspaceId: "lws_new", visible: true };
    for (const owner of [
      { projectId: "lpj_previous", workspaceId: "lws_previous" },
      { projectId: "lpj_new", workspaceId: null },
      { projectId: "lpj_new", workspaceId: "lws_previous" },
    ]) {
      if (canApplyWorkbenchIntentToScope({ ...target, ...owner }))
        markWorkbenchIntentApplied(intent);
      expect(wasWorkbenchIntentApplied(intent)).toBe(false);
    }
    expect(
      canApplyWorkbenchIntentToScope({ ...target, projectId: "lpj_new", workspaceId: "lws_new" }),
    ).toBe(true);
    markWorkbenchIntentApplied(intent);
    expect(wasWorkbenchIntentApplied(intent)).toBe(true);
  });

  it("does not let a hidden retained surface consume navigation", () => {
    expect(
      canApplyWorkbenchIntentToScope({
        projectId: "lpj_new",
        workspaceId: "lws_new",
        targetProjectId: "lpj_new",
        targetWorkspaceId: "lws_new",
        visible: false,
      }),
    ).toBe(false);
  });

  it("keeps ordinary unscoped tile actions available on the visible workbench", () => {
    expect(
      canApplyWorkbenchIntentToScope({
        projectId: "lpj_existing",
        workspaceId: "lws_existing",
        targetProjectId: null,
        targetWorkspaceId: null,
        visible: true,
      }),
    ).toBe(true);
  });
});
