import { describe, expect, it } from "vitest";

import {
  parseScheduledTaskProposals,
  parseProposedStartAt,
} from "@shared/scheduledTaskProposal";

function block(body: string): string {
  return ["Sure, here is the schedule:", "", "```cozea-scheduled-task", body, "```"].join("\n");
}

describe("scheduled task proposals from an agent", () => {
  it("reads a complete proposal out of a reply", () => {
    const [proposal] = parseScheduledTaskProposals(
      block(
        JSON.stringify({
          name: "Morning news summary",
          prompt: "Summarize today's top stories.",
          provider: "claude",
          computerUse: false,
          project: null,
          startAt: "2026-09-06T09:00",
          repeat: { unit: "days", interval: 1 },
        }),
      ),
    );

    expect(proposal).toMatchObject({
      model: null,
      name: "Morning news summary",
      prompt: "Summarize today's top stories.",
      provider: "claude",
      computerUse: false,
      project: null,
      recurrence: { unit: "days", interval: 1 },
      missing: [],
    });
    expect(proposal?.startAt).toBe(new Date(2026, 8, 6, 9, 0, 0, 0).getTime());
  });

  it("names what a person still has to fill in", () => {
    const [proposal] = parseScheduledTaskProposals(
      block(JSON.stringify({ name: "Weekly cleanup" })),
    );

    expect(proposal?.missing).toEqual(["prompt", "startAt"]);
    expect(proposal?.recurrence).toEqual({ unit: null, interval: 1 });
  });

  it("resolves the project the agent meant", () => {
    const current = parseScheduledTaskProposals(
      block(JSON.stringify({ name: "A", prompt: "B", project: "current" })),
    )[0];
    const path = parseScheduledTaskProposals(
      block(JSON.stringify({ name: "A", prompt: "B", project: "/repos/alpha" })),
    )[0];
    const none = parseScheduledTaskProposals(
      block(JSON.stringify({ name: "A", prompt: "B", project: "none" })),
    )[0];

    expect(current?.project).toEqual({ kind: "current" });
    expect(path?.project).toEqual({ kind: "path", workspaceRoot: "/repos/alpha" });
    expect(none?.project).toBeNull();
  });

  it("ignores a block that is still being streamed", () => {
    const partial = '```cozea-scheduled-task\n{ "name": "Half a ta';

    expect(parseScheduledTaskProposals(partial)).toEqual([]);
  });

  it("ignores prose and unrelated code blocks", () => {
    expect(parseScheduledTaskProposals("Let's schedule it for tomorrow.")).toEqual([]);
    expect(parseScheduledTaskProposals('```json\n{"name":"x","prompt":"y"}\n```')).toEqual([]);
    // Tagged, but carrying nothing worth acting on.
    expect(parseScheduledTaskProposals(block(JSON.stringify({ repeat: "daily" })))).toEqual([]);
  });

  it("reads both spellings of a time and rejects nonsense", () => {
    expect(parseProposedStartAt("2026-09-06T09:00")).toBe(
      new Date(2026, 8, 6, 9, 0, 0, 0).getTime(),
    );
    expect(parseProposedStartAt("not a time")).toBeNull();
    expect(parseProposedStartAt(undefined)).toBeNull();
  });

  it("carries a model the person named", () => {
    const [proposal] = parseScheduledTaskProposals(
      block(JSON.stringify({ name: "A", prompt: "B", model: "claude-opus-4-6" })),
    );

    expect(proposal?.model).toBe("claude-opus-4-6");
  });
});
