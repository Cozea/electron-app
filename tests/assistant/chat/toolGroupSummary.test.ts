import { TurnId } from "@cozea/assistant-contracts";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "@/features/assistant/chat/session-logic";
import {
  omitSupersededLifecycleMarkers,
  summarizeToolGroup,
  toolGroupAction,
  toolGroupSummaryKind,
  workEntryIndicatesFailure,
  workGroupId,
  workLogEntryIsLocalCodeSearch,
  workLogEntryIsToolLike,
} from "@/features/assistant/chat/MessagesTimeline.logic";

let nextId = 0;
const entry = (overrides: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id: `entry-${(nextId += 1)}`,
  createdAt: "2026-01-01T00:00:00Z",
  label: "Tool",
  tone: "tool",
  ...overrides,
});

describe("toolGroupAction", () => {
  it("classifies reads from request kind, image views, and the Read File tool", () => {
    expect(toolGroupAction(entry({ requestKind: "file-read" }))).toBe("read");
    expect(toolGroupAction(entry({ itemType: "image_view" }))).toBe("read");
    expect(
      toolGroupAction(entry({ itemType: "dynamic_tool_call", toolTitle: "Read File" })),
    ).toBe("read");
  });

  it("classifies edits from request kind, item type, or the presence of changed files", () => {
    expect(toolGroupAction(entry({ requestKind: "file-change" }))).toBe("edit");
    expect(toolGroupAction(entry({ itemType: "file_change" }))).toBe("edit");
    expect(toolGroupAction(entry({ changedFiles: ["src/a.ts"] }))).toBe("edit");
  });

  it("classifies commands, and treats a bare command string as one", () => {
    expect(toolGroupAction(entry({ itemType: "command_execution" }))).toBe("command");
    expect(toolGroupAction(entry({ requestKind: "command" }))).toBe("command");
    expect(toolGroupAction(entry({ command: "bun test" }))).toBe("command");
  });

  it("separates local grep from web search, which share an item type", () => {
    expect(toolGroupAction(entry({ itemType: "web_search", label: "Grep" }))).toBe("code-search");
    expect(toolGroupAction(entry({ itemType: "web_search", label: "Search" }))).toBe("search");
  });

  it("prefers toolTitle over label when detecting grep", () => {
    expect(
      workLogEntryIsLocalCodeSearch(
        entry({ itemType: "web_search", toolTitle: "grep complete", label: "Search" }),
      ),
    ).toBe(true);
  });

  it("falls back to other", () => {
    expect(toolGroupAction(entry({ itemType: "mcp_tool_call" }))).toBe("other");
  });

  it("ranks read ahead of edit when an entry could be both", () => {
    // A file-read approval that also reports changedFiles must not be counted
    // as an edit, or read-only tool calls inflate the "Changed N files" count.
    expect(toolGroupAction(entry({ requestKind: "file-read", changedFiles: ["a.ts"] }))).toBe(
      "read",
    );
  });
});

describe("summarizeToolGroup", () => {
  it("summarizes a single action group", () => {
    expect(
      summarizeToolGroup([
        entry({ requestKind: "file-read" }),
        entry({ requestKind: "file-read" }),
      ]),
    ).toBe("Read 2 files");
  });

  it("singularizes a count of one", () => {
    expect(summarizeToolGroup([entry({ itemType: "command_execution" })])).toBe("Ran 1 command");
  });

  it("counts edits by distinct file rather than by call", () => {
    const summary = summarizeToolGroup([
      entry({ changedFiles: ["src/a.ts"] }),
      entry({ changedFiles: ["src/a.ts"] }),
      entry({ changedFiles: ["src/b.ts"] }),
    ]);
    expect(summary).toBe("Changed 2 files");
  });

  it("still counts edits that carry no file details", () => {
    const summary = summarizeToolGroup([
      entry({ changedFiles: ["src/a.ts"] }),
      entry({ itemType: "file_change" }),
    ]);
    expect(summary).toBe("Changed 2 files");
  });

  it("joins two groups with and, lowercasing the trailing clause", () => {
    expect(
      summarizeToolGroup([
        entry({ requestKind: "file-read" }),
        entry({ itemType: "command_execution" }),
      ]),
    ).toBe("Read 1 file and ran 1 command");
  });

  it("uses an Oxford comma for three or more groups", () => {
    expect(
      summarizeToolGroup([
        entry({ requestKind: "file-read" }),
        entry({ itemType: "command_execution" }),
        entry({ itemType: "web_search", label: "Grep" }),
      ]),
    ).toBe("Read 1 file, ran 1 command, and searched code 1 time");
  });

  it("returns an empty string for no entries", () => {
    expect(summarizeToolGroup([])).toBe("");
  });

  it("does not double-count a superseded lifecycle marker", () => {
    // The start marker has no id and no status, so it is the same call as the
    // completion below it — the summary must say one command, not two.
    const summary = summarizeToolGroup([
      entry({
        label: "Terminal",
        itemType: "command_execution",
        sourceActivityKind: "tool.started",
        turnId: TurnId.make("turn-1"),
      }),
      entry({
        label: "Terminal",
        itemType: "command_execution",
        sourceActivityKind: "tool.completed",
        turnId: TurnId.make("turn-1"),
      }),
    ]);
    expect(summary).toBe("Ran 1 command");
  });
});

describe("omitSupersededLifecycleMarkers", () => {
  const started = (label: string, turnId: string) =>
    entry({
      label,
      itemType: "command_execution",
      sourceActivityKind: "tool.started",
      turnId: TurnId.make(turnId),
    });
  const completed = (label: string, turnId: string) =>
    entry({
      label,
      itemType: "command_execution",
      sourceActivityKind: "tool.completed",
      turnId: TurnId.make(turnId),
    });

  it("drops an id-less start marker superseded by a later completion", () => {
    const entries = [started("Terminal", "t1"), completed("Terminal", "t1")];
    const result = omitSupersededLifecycleMarkers(entries, (item) => item);
    expect(result).toEqual([entries[1]]);
  });

  it("keeps the start marker when no completion follows", () => {
    const entries = [started("Terminal", "t1")];
    expect(omitSupersededLifecycleMarkers(entries, (item) => item)).toEqual(entries);
  });

  it("does not merge markers across different turns", () => {
    const entries = [started("Terminal", "t1"), completed("Terminal", "t2")];
    expect(omitSupersededLifecycleMarkers(entries, (item) => item)).toEqual(entries);
  });

  it("keeps a start marker that carries a tool call id", () => {
    // A provider-supplied id means the pair can be correlated properly
    // elsewhere, so the marker is real state rather than a duplicate.
    const entries = [
      entry({
        label: "Terminal",
        itemType: "command_execution",
        sourceActivityKind: "tool.started",
        toolCallId: "call-1",
        turnId: TurnId.make("t1"),
      }),
      completed("Terminal", "t1"),
    ];
    expect(omitSupersededLifecycleMarkers(entries, (item) => item)).toEqual(entries);
  });

  it("keeps a start marker that carries a lifecycle status", () => {
    const entries = [
      entry({
        label: "Terminal",
        itemType: "command_execution",
        sourceActivityKind: "tool.started",
        toolLifecycleStatus: "inProgress",
        turnId: TurnId.make("t1"),
      }),
      completed("Terminal", "t1"),
    ];
    expect(omitSupersededLifecycleMarkers(entries, (item) => item)).toEqual(entries);
  });

  it("treats a completion-suffixed label as the same identity", () => {
    const entries = [
      started("Terminal", "t1"),
      entry({
        label: "Terminal complete",
        itemType: "command_execution",
        sourceActivityKind: "tool.completed",
        turnId: TurnId.make("t1"),
      }),
    ];
    expect(omitSupersededLifecycleMarkers(entries, (item) => item)).toHaveLength(1);
  });

  it("preserves original order", () => {
    const a = completed("A", "t1");
    const b = completed("B", "t1");
    const c = completed("C", "t1");
    expect(omitSupersededLifecycleMarkers([a, b, c], (item) => item)).toEqual([a, b, c]);
  });

  it("unwraps entries through the accessor", () => {
    const wrapped = [{ entry: started("Terminal", "t1") }, { entry: completed("Terminal", "t1") }];
    const result = omitSupersededLifecycleMarkers(wrapped, (item) => item.entry);
    expect(result).toEqual([wrapped[1]]);
  });
});

describe("toolGroupSummaryKind", () => {
  it("returns the shared action when the group is uniform", () => {
    expect(
      toolGroupSummaryKind([entry({ requestKind: "file-read" }), entry({ requestKind: "file-read" })]),
    ).toBe("read");
  });

  it("returns mixed when actions differ", () => {
    expect(
      toolGroupSummaryKind([entry({ requestKind: "file-read" }), entry({ command: "ls" })]),
    ).toBe("mixed");
  });

  it("refines an all-other group by item type", () => {
    expect(toolGroupSummaryKind([entry({ itemType: "dynamic_tool_call" })])).toBe("dynamic-tool");
    expect(toolGroupSummaryKind([entry({ itemType: "collab_agent_tool_call" })])).toBe("agent-tool");
    expect(toolGroupSummaryKind([entry({ itemType: "mcp_tool_call" })])).toBe("other");
  });

  it("refines by tone when no item type applies", () => {
    expect(toolGroupSummaryKind([entry({ tone: "thinking" })])).toBe("agent-tool");
    expect(toolGroupSummaryKind([entry({ tone: "tool" })])).toBe("tone-tool");
    expect(toolGroupSummaryKind([entry({ tone: "info" })])).toBe("other");
  });

  it("returns mixed when an all-other group refines inconsistently", () => {
    expect(
      toolGroupSummaryKind([entry({ itemType: "dynamic_tool_call" }), entry({ tone: "thinking" })]),
    ).toBe("mixed");
  });
});

describe("workGroupId", () => {
  it("prefers the provider tool call id so the group survives lifecycle updates", () => {
    const id = workGroupId(
      "timeline-1",
      entry({ toolCallId: "call-9", turnId: TurnId.make("t1") }),
    );
    expect(id).toBe("work-group:tool:t1:call-9");
  });

  it("falls back to the timeline entry id", () => {
    expect(workGroupId("timeline-1", entry())).toBe("work-group:timeline-1");
  });

  it("scopes an id-bearing entry with no turn", () => {
    expect(workGroupId("timeline-1", entry({ toolCallId: "call-9" }))).toBe(
      "work-group:tool:no-turn:call-9",
    );
  });
});

describe("workLogEntryIsToolLike", () => {
  it("accepts tool, thinking, and error tones", () => {
    expect(workLogEntryIsToolLike(entry({ tone: "tool" }))).toBe(true);
    expect(workLogEntryIsToolLike(entry({ tone: "thinking" }))).toBe(true);
    expect(workLogEntryIsToolLike(entry({ tone: "error" }))).toBe(true);
  });

  it("rejects plain info narration", () => {
    expect(workLogEntryIsToolLike(entry({ tone: "info" }))).toBe(false);
  });

  it("accepts an info row that still carries tool metadata", () => {
    expect(workLogEntryIsToolLike(entry({ tone: "info", command: "bun test" }))).toBe(true);
    expect(workLogEntryIsToolLike(entry({ tone: "info", requestKind: "command" }))).toBe(true);
    expect(workLogEntryIsToolLike(entry({ tone: "info", itemType: "file_change" }))).toBe(true);
  });

  it("ignores a blank command", () => {
    expect(workLogEntryIsToolLike(entry({ tone: "info", command: "   " }))).toBe(false);
  });
});

describe("workEntryIndicatesFailure", () => {
  it("flags failed status and error tone", () => {
    expect(workEntryIndicatesFailure(entry({ status: "failed" }))).toBe(true);
    expect(workEntryIndicatesFailure(entry({ tone: "error" }))).toBe(true);
  });

  it("does not flag completed, cancelled, or in-progress work", () => {
    expect(workEntryIndicatesFailure(entry({ status: "completed" }))).toBe(false);
    expect(workEntryIndicatesFailure(entry({ status: "cancelled" }))).toBe(false);
    expect(workEntryIndicatesFailure(entry({ status: "inProgress" }))).toBe(false);
    expect(workEntryIndicatesFailure(entry())).toBe(false);
  });
});
