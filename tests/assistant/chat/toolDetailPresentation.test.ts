import { describe, expect, it } from "vitest";

import {
  isGenericToolTitle,
  normalizeToolRowPresentation,
  normalizedToolAction,
  parseToolDetail,
} from "@/features/projects/components/assistant/chat/toolDetailPresentation";

describe("isGenericToolTitle", () => {
  it("flags the category labels providers emit", () => {
    for (const title of ["Tool call", "MCP tool call", "File change", "Command run", "Item"]) {
      expect(isGenericToolTitle(title)).toBe(true);
    }
  });

  it("treats a missing title as generic", () => {
    expect(isGenericToolTitle(undefined)).toBe(true);
  });

  it("leaves already-good titles alone", () => {
    for (const title of ["Read file", "Ran command", "t3-code · preview_status"]) {
      expect(isGenericToolTitle(title)).toBe(false);
    }
  });
});

describe("parseToolDetail", () => {
  it("splits a tool name from its JSON arguments", () => {
    expect(parseToolDetail(`Read: {"file_path":"/repo/src/a.ts"}`)).toEqual({
      toolName: "Read",
      args: { file_path: "/repo/src/a.ts" },
      text: null,
    });
  });

  it("keeps a plain-text tail as text", () => {
    expect(parseToolDetail("Bash: bun test")).toEqual({
      toolName: "Bash",
      args: null,
      text: "bun test",
    });
  });

  it("survives the adapter truncating long payloads", () => {
    const parsed = parseToolDetail(`Read: {"file_path":"/repo/very/long/pa...`);
    expect(parsed?.toolName).toBe("Read");
    expect(parsed?.args).toBeNull();
  });

  it("rejects prose that merely contains a colon", () => {
    expect(parseToolDetail("Reading the file: it went fine")).toBeNull();
    expect(parseToolDetail("note: something")).not.toBeNull(); // bare identifier is fine
    expect(parseToolDetail("2 files: a and b")).toBeNull();
  });

  it("returns null for empty or shapeless input", () => {
    expect(parseToolDetail(undefined)).toBeNull();
    expect(parseToolDetail("")).toBeNull();
    expect(parseToolDetail("no separator here")).toBeNull();
    expect(parseToolDetail("Read: ")).toBeNull();
  });
});

describe("normalizeToolRowPresentation", () => {
  const norm = (detail: string, title = "Tool call") =>
    normalizeToolRowPresentation({ title, detail });

  it("turns a raw Read into a verb plus the file's basename", () => {
    expect(norm(`Read: {"file_path":"/repo/src/a.ts"}`)).toEqual({
      heading: "Read",
      detail: "a.ts",
      path: "/repo/src/a.ts",
      stat: undefined,
    });
  });

  it("handles edits, writes and deletes", () => {
    expect(norm(`Edit: {"file_path":"/repo/src/a.ts"}`)?.heading).toBe("Edited");
    expect(norm(`MultiEdit: {"file_path":"/repo/src/a.ts"}`)?.heading).toBe("Edited");
    expect(norm(`Write: {"file_path":"/repo/src/a.ts"}`)?.heading).toBe("Created");
  });

  it("derives line counts for a created file", () => {
    const content = Array.from({ length: 141 }, (_, i) => `line ${i}`).join("\n");
    expect(
      norm(`Write: ${JSON.stringify({ file_path: "/repo/t.ts", content })}`)?.stat,
    ).toEqual({ additions: 141, deletions: 0 });
  });

  it("derives line counts for an edit from its before and after strings", () => {
    expect(
      norm(`Edit: ${JSON.stringify({ file_path: "/repo/a.ts", old_string: "a\nb", new_string: "a\nb\nc" })}`)
        ?.stat,
    ).toEqual({ additions: 3, deletions: 2 });
  });

  it("sums a multi-edit across its edits array", () => {
    const args = { file_path: "/repo/a.ts", edits: [
      { old_string: "a", new_string: "a\nb" },
      { old_string: "x\ny", new_string: "z" },
    ] };
    expect(norm(`MultiEdit: ${JSON.stringify(args)}`)?.stat).toEqual({
      additions: 3,
      deletions: 3,
    });
  });

  it("omits the stat when the arguments carry no content", () => {
    expect(norm(`Edit: {"file_path":"/repo/a.ts"}`)?.stat).toBeUndefined();
    expect(norm(`Read: {"file_path":"/repo/a.ts"}`)?.stat).toBeUndefined();
  });

  it("handles commands from both JSON and text forms", () => {
    expect(norm(`Bash: {"command":"bun test"}`)?.heading).toBe("Ran");
    expect(norm(`Bash: {"command":"bun test"}`)?.detail).toBe("bun test");
    expect(norm("Bash: bun test")?.detail).toBe("bun test");
  });

  it("handles searches", () => {
    expect(norm(`Grep: {"pattern":"TODO"}`)?.heading).toBe("Searched");
    expect(norm(`Grep: {"pattern":"TODO"}`)?.detail).toBe("TODO");
    expect(norm(`WebSearch: {"query":"effect atoms"}`)?.heading).toBe("Searched the web");
  });

  it("drops the MCP server prefix and keeps the tool name", () => {
    expect(norm(`mcp__t3-code__preview_status: {}`)?.heading).toBe("preview_status");
    expect(norm(`mcp__some_server__do_thing: {}`)?.heading).toBe("do_thing");
  });

  it("falls back to the tool name for anything unrecognized", () => {
    expect(norm(`ToolSearch: {"query":"select:Read"}`)?.heading).toBe("ToolSearch");
    expect(norm(`ToolSearch: {"query":"select:Read"}`)?.detail).toBe("select:Read");
  });

  it("leaves rows alone when the provider already labelled them well", () => {
    expect(norm(`Read: {"file_path":"/repo/a.ts"}`, "Read file")).toBeNull();
    expect(norm(`Read: {"file_path":"/repo/a.ts"}`, "t3-code · preview_status")).toBeNull();
  });

  it("leaves rows alone when the detail is not a tool payload", () => {
    expect(norm("just some prose")).toBeNull();
  });
});

describe("normalizedToolAction", () => {
  const action = (detail: string) => normalizedToolAction({ title: "Tool call", detail });

  it("recovers the action so group summaries can count properly", () => {
    expect(action(`Read: {"file_path":"/a.ts"}`)).toBe("read");
    expect(action(`Edit: {"file_path":"/a.ts"}`)).toBe("edit");
    expect(action("Bash: bun test")).toBe("command");
    expect(action(`Grep: {"pattern":"x"}`)).toBe("code-search");
    expect(action(`WebSearch: {"query":"x"}`)).toBe("search");
  });

  it("returns null for unrecognized tools rather than guessing", () => {
    expect(action(`ToolSearch: {"query":"x"}`)).toBeNull();
    expect(action(`mcp__t3-code__preview_status: {}`)).toBeNull();
  });

  it("returns null when the row was already well labelled", () => {
    expect(normalizedToolAction({ title: "Read file", detail: `Read: {"file_path":"/a"}` })).toBeNull();
  });
});
