import { describe, expect, it } from "vitest";
import {
  deriveAssistantTurnRunning,
  deriveTitleSeed,
} from "../../apps/desktop/src/features/projects/components/workbench/assistant/workbenchAssistantShared";
import { flushWorkbenchStorage } from "../../apps/desktop/src/stores/useProjectWorkbenchStore";

describe("assistantTileBootstrap", () => {
  it("derives clean thread titles from initial user prompts", () => {
    expect(deriveTitleSeed({ prompt: "What is an API?", images: [], terminalContexts: [] })).toBe(
      "What is an API?",
    );

    const longPrompt = "Can you help me write a comprehensive full-stack application with authentication, database, and real-time websockets in React and Node.js?";
    const title = deriveTitleSeed({ prompt: longPrompt, images: [], terminalContexts: [] });
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/^Can you help me write/);
  });

  it("safely handles workbench storage flushing", () => {
    expect(() => flushWorkbenchStorage()).not.toThrow();
  });

  it("extracts existing project ID from T3 invariant error message", () => {
    const errorMsg =
      "Orchestration command invariant failed (project.create): Active project 'proj-abc-123' already exists for workspace root '/Users/admin/Developer/Cozea/test-project'.";
    const match = errorMsg.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("proj-abc-123");
  });

  it("treats the direct T3 thread stream as the live turn authority", () => {
    expect(
      deriveAssistantTurnRunning({
        orchestrationStatus: "ready",
        streamIsStreaming: true,
      }),
    ).toBe(true);
    expect(
      deriveAssistantTurnRunning({
        orchestrationStatus: "starting",
        streamIsStreaming: false,
      }),
    ).toBe(true);
    expect(
      deriveAssistantTurnRunning({
        orchestrationStatus: "ready",
        streamIsStreaming: false,
      }),
    ).toBe(false);
  });
});
