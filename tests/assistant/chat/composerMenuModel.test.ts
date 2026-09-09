import { describe, expect, it } from "vitest";
import { buildComposerPathMenuItems, filterSlashItems, planTitleFromMarkdown } from "@/features/assistant/chat/composerMenuModel";
import { workEntryPreview, workEntryRawCommand, workEntryPreviewDuplicatesSingleChangedFile } from "@/features/assistant/chat/workEntryPresentation";

describe("composer menu presentation", () => {
  it("deduplicates normalized paths and lists directories before files", () => {
    const items = buildComposerPathMenuItems([{ path: "src\\a.ts" }, { path: "/src/a.ts" }, { path: "src/b.ts" }], ".");
    expect(items.map((item) => item.id)).toEqual(["directory:src", "file:src/a.ts", "file:src/b.ts"]);
    expect(buildComposerPathMenuItems([{ path: "src/a.ts" }], "A.TS", 1)[0]?.path).toBe("src/a.ts");
  });
  it("searches slash commands and extracts a plan heading", () => {
    const items = [{ label: "Plan", description: "Outline the work" }];
    expect(filterSlashItems(items, "/OUTLINE")).toEqual(items);
    expect(planTitleFromMarkdown("intro\n\n## Build this\nbody")).toBe("Build this");
    expect(planTitleFromMarkdown("No heading")).toBeNull();
  });
});

describe("work entry presentation", () => {
  it("prefers a command over detail and hides identical raw commands", () => {
    expect(workEntryPreview({ command: "bun test", detail: "detail", changedFiles: [] }, undefined)).toBe("bun test");
    expect(workEntryRawCommand({ command: "bun test", rawCommand: " bun test " })).toBeNull();
    expect(workEntryRawCommand({ command: "bun test", rawCommand: "env bun test" })).toBe("env bun test");
  });
  it("recognizes a redundant single-file preview", () => {
    expect(workEntryPreviewDuplicatesSingleChangedFile({ changedFiles: ["src/a.ts"] }, "src/a.ts", undefined)).toBe(true);
    expect(workEntryPreviewDuplicatesSingleChangedFile({ changedFiles: ["src/a.ts", "src/b.ts"] }, "src/a.ts", undefined)).toBe(false);
  });
});
