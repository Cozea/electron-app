import { describe, expect, it } from "vitest";
import {
  deriveAssistantTurnRunning,
  deriveTitleSeed,
  resolveRememberedModelSelection,
} from "../../apps/desktop/src/features/projects/components/workbench/assistant/workbenchAssistantShared";
import { flushWorkbenchStorage } from "../../apps/desktop/src/stores/useProjectWorkbenchStore";
import { ProviderInstanceId } from "@cozea/assistant-contracts"

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

  it("uses the last selected model when a fresh provider tile opens", () => {
    const fallbackSelection = {
      provider: "opencode" as const,
      instanceId: ProviderInstanceId.make("opencode"),
      model: "opencode/default-model",
    };

    expect(
      resolveRememberedModelSelection({
        fallbackSelection,
        explicitTileModel: null,
        rememberedSelection: {
          provider: "opencode",
          instanceId: ProviderInstanceId.make("opencode"),
          model: "opencode/last-used-model",
        },
        selectableModels: [
          { slug: "opencode/default-model", name: "Default model" },
          { slug: "opencode/last-used-model", name: "Last used model" },
        ],
      }),
    ).toMatchObject({ model: "opencode/last-used-model" });
  });

  it("keeps an existing tile's model ahead of the remembered default", () => {
    const fallbackSelection = {
      provider: "codex" as const,
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-existing",
    };

    expect(
      resolveRememberedModelSelection({
        fallbackSelection,
        explicitTileModel: "gpt-existing",
        rememberedSelection: {
          provider: "codex",
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-remembered",
        },
        selectableModels: [
          { slug: "gpt-existing", name: "Existing" },
          { slug: "gpt-remembered", name: "Remembered" },
        ],
      }),
    ).toBe(fallbackSelection);
  });

  it("ignores remembered models from another provider instance or a stale catalog", () => {
    const fallbackSelection = {
      provider: "claudeAgent" as const,
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-current",
    };

    expect(
      resolveRememberedModelSelection({
        fallbackSelection,
        explicitTileModel: null,
        rememberedSelection: {
          provider: "claudeAgent",
          instanceId: ProviderInstanceId.make("claudeAgent-other"),
          model: "claude-other",
        },
        selectableModels: [{ slug: "claude-current", name: "Current" }],
      }),
    ).toBe(fallbackSelection);

    expect(
      resolveRememberedModelSelection({
        fallbackSelection,
        explicitTileModel: null,
        rememberedSelection: {
          provider: "claudeAgent",
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-removed",
        },
        selectableModels: [{ slug: "claude-current", name: "Current" }],
      }),
    ).toBe(fallbackSelection);
  });
});
