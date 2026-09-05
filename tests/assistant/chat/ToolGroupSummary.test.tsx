import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolGroupSummary } from "@/features/assistant/chat/ToolGroupSummary";

describe("plain tool summary", () => {
  it("passes a stable component type to LegendList rather than an inline component", () => {
    const source = readFileSync(
      "apps/desktop/src/features/assistant/chat/MessagesTimeline.tsx",
      "utf8",
    );
    expect(source).toContain("renderItem={TimelineRowRenderer}");
    expect(source).toContain("<TimelineRowRenderContext.Provider value={renderRowContent}>");
    expect(source).not.toContain("renderItem={({ item:");
  });
  it("keeps a fixed-height, tabular count without pill chrome", () => {
    const html = renderToStaticMarkup(
      createElement(ToolGroupSummary, {
        rowId: "row",
        groupId: "group",
        summary: "Used 8 tools",
        count: 8,
        expanded: false,
        active: false,
        animateEntrance: false,
        seenRows: new Set<string>(),
        onToggle: () => {},
      }),
    );
    expect(html).toContain("Used 8 tools");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("h-7");
    expect(html).toContain("tabular-nums");
    expect(html).not.toMatch(/rounded-|border-border|bg-card/);
    expect(html).toContain("focus-visible:ring-2");
  });

  it("uses failure counts without completion or error icons", () => {
    const html = renderToStaticMarkup(
      createElement(ToolGroupSummary, {
        rowId: "row",
        groupId: "group",
        summary: "Used 8 tools · 2 actions failed",
        count: 10,
        expanded: true,
        active: false,
        animateEntrance: false,
        seenRows: new Set<string>(),
        onToggle: () => {},
      }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("text-destructive");
    expect(html).toContain("2 actions failed");
    expect(html.match(/<svg/g)).toHaveLength(1); // disclosure only
  });

  it("shimmers the active summary only while collapsed", () => {
    const render = (expanded: boolean) =>
      renderToStaticMarkup(
        createElement(ToolGroupSummary, {
          rowId: "row",
          groupId: "group",
          summary: "Read 4 files",
          count: 4,
          expanded,
          active: true,
          animateEntrance: false,
          seenRows: new Set<string>(),
          onToggle: () => {},
        }),
      );
    expect(render(false)).toContain("cozea-live-shimmer-focus");
    expect(render(true)).not.toContain("cozea-live-shimmer-focus");
    expect(render(true)).toContain("motion-reduce:transition-none");
  });
});
