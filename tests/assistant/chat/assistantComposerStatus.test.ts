import { describe, expect, it } from "vitest";
import { renderAssistantComposerStatus } from "@/features/workbench/assistant/AssistantComposerStatus";

const healthy = {
  historyError: null,
  bindingError: null,
  operationError: null,
  configError: null,
  provider: "codex" as const,
  onRetryBinding: () => {},
  onRemediationResolved: () => {},
};

describe("composer status layout contract", () => {
  it("returns literal null when healthy so an empty composer remains compact", () => {
    expect(renderAssistantComposerStatus(healthy)).toBeNull();
  });
  it("returns visible content for each error and clears it when resolved", () => {
    for (const field of ["historyError", "bindingError", "operationError", "configError"] as const) {
      expect(renderAssistantComposerStatus({ ...healthy, [field]: "Problem" })).not.toBeNull();
      expect(renderAssistantComposerStatus({ ...healthy, [field]: "" })).toBeNull();
    }
  });
});
