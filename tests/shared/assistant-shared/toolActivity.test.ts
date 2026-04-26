import { describe, expect, it } from "vitest";

import { deriveToolActivityPresentation } from "../../../shared/assistant-shared/toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toMatchObject({
      summary: "Ran command",
      detail: "bun run lint",
      command: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toMatchObject({
      summary: "Read file",
      detail: "/tmp/app.ts",
      primaryPath: "/tmp/app.ts",
      changedPaths: ["/tmp/app.ts"],
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toMatchObject({
      summary: "Read file",
    });
  });

  it("keeps both normalized and raw wrapped commands", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        data: {
          rawInput: {
            executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            args: ["-Command", "rg -n foo ."],
          },
        },
        fallbackSummary: "Terminal",
      }),
    ).toMatchObject({
      summary: "Ran command",
      detail: "C:\\Program Files\\PowerShell\\7\\pwsh.exe -Command \"rg -n foo .\"",
      command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe -Command \"rg -n foo .\"",
    });
  });

  it("extracts changed paths from nested file-change payloads", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "file_change",
        title: "Edit files",
        data: {
          item: {
            changes: [{ path: "src/app.ts" }, { filename: "src/lib/util.ts" }],
          },
        },
        fallbackSummary: "Edit files",
      }),
    ).toMatchObject({
      summary: "Changed files",
      detail: "src/app.ts",
      primaryPath: "src/app.ts",
      changedPaths: ["src/app.ts", "src/lib/util.ts"],
    });
  });

  it("uses raw output summaries for search tools when the query is unavailable", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "grep",
        detail: "grep",
        data: {
          kind: "search",
          rawOutput: {
            totalFiles: 19,
            truncated: false,
          },
        },
        fallbackSummary: "grep",
      }),
    ).toMatchObject({
      summary: "Searched files",
      detail: "19 files",
    });
  });
});
