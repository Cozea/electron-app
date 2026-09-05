import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("keeps Working after the temporary Thinking row at the timeline bottom", () => {
    const rowDerivation = sourceBetween(
      timelineSource,
      "const rows = useMemo<TimelineRow[]>(() => {",
      "const latestAssistantMessageId = useMemo",
    );
    const thinkingRow = rowDerivation.indexOf('id: "thinking-indicator-row"');
    const trailingTurnStatuses = rowDerivation.indexOf(
      "appendTurnStatusRows(timelineEntries.length);",
    );

    expect(thinkingRow).toBeGreaterThanOrEqual(0);
    expect(trailingTurnStatuses).toBeGreaterThan(thinkingRow);
  });
});
