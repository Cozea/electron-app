import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConversationRows } from "@/features/assistant/chat/conversationRows";

const timelineSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/MessagesTimeline.tsx",
  ),
  "utf8",
);

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("active agent working status placement", () => {
  it("reserves the divider for completed turns without changing the live indicator", () => {
    const statusRow = sourceBetween(
      timelineSource,
      "const TurnStatusRow = memo(function TurnStatusRow",
      "const ThinkingIndicatorRow = memo",
    );

    expect(statusRow).toContain("const isActive = summary === null;");
    expect(statusRow).toContain('!isActive && "border-b border-border/60"');
    expect(statusRow.match(/\bborder-b\b/g)).toHaveLength(1);
    expect(statusRow).toContain("<LiveShimmerText>Working</LiveShimmerText>");
    expect(statusRow).toContain("<WorkingTimer startedAtIso={startedAtIso} />");
  });

  it("uses one live status at the timeline bottom, with Thinking replacing Working", () => {
    const input = { entries: [], isWorking: true, activeWorkStartedAt: "2026-09-05T00:00:00Z", expanded: {} };
    expect(buildConversationRows({ ...input, generationStatusPhase: "thinking" }).map((row) => row.kind)).toEqual(["thinking"]);
    expect(buildConversationRows({ ...input, generationStatusPhase: "working" }).map((row) => row.kind)).toEqual(["turn-status"]);
  });
});
