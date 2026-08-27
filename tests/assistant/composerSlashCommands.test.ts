import { describe, expect, it } from "vitest";
import {
  detectComposerTrigger,
  filterSlashItems,
} from "../../apps/desktop/src/features/projects/components/assistant/composer-logic";
import {
  splitPromptIntoComposerSegments,
} from "../../apps/desktop/src/features/projects/components/assistant/composer-editor-mentions";

describe("composer triggers and slash commands", () => {
  it("detects @ file mention triggers", () => {
    const trigger = detectComposerTrigger("@src/index", 10);
    expect(trigger).not.toBeNull();
    expect(trigger?.kind).toBe("path");
    expect(trigger?.query).toBe("src/index");
  });

  it("detects / slash command triggers at the start of input", () => {
    const trigger = detectComposerTrigger("/plan", 5);
    expect(trigger).not.toBeNull();
    expect(trigger?.kind).toBe("slash-command");
    expect(trigger?.query).toBe("plan");
  });

  it("filters slash command menu items by query", () => {
    const items = [
      { id: "slash:model", type: "slash-command" as const, command: "model" as const, label: "/model", description: "Switch model" },
      { id: "slash:plan", type: "slash-command" as const, command: "plan" as const, label: "/plan", description: "Plan mode" },
      { id: "slash:clear", type: "slash-command" as const, command: "clear" as const, label: "/clear", description: "Clear" },
      { id: "slash:help", type: "slash-command" as const, command: "help" as const, label: "/help", description: "Help" },
    ];

    const matched = filterSlashItems(items, "pl");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.label).toBe("/plan");

    const matchedAll = filterSlashItems(items, "");
    expect(matchedAll).toHaveLength(4);
  });

  it("splits prompt into text and mention segments cleanly", () => {
    const segments = splitPromptIntoComposerSegments("Look at @src/main.ts and fix the bug");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", text: "Look at " });
    expect(segments[1]).toEqual({ type: "mention", path: "src/main.ts" });
    expect(segments[2]).toEqual({ type: "text", text: " and fix the bug" });
  });
});
