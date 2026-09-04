import { describe, expect, it } from "vitest";

import type { TurnDiffFileChange } from "@/features/assistant/model/types";
import {
  CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT,
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
} from "@/features/assistant/chat/changedFilesPresentation";

const file = (path: string, additions = 0, deletions = 0): TurnDiffFileChange => ({
  path,
  additions,
  deletions,
});

describe("changedFileName", () => {
  it("returns the basename for posix and windows paths", () => {
    expect(changedFileName("src/features/chat/Timeline.tsx")).toBe("Timeline.tsx");
    expect(changedFileName("src\\features\\chat\\Timeline.tsx")).toBe("Timeline.tsx");
  });

  it("passes through a bare filename and tolerates trailing slashes", () => {
    expect(changedFileName("README.md")).toBe("README.md");
    expect(changedFileName("src/lib/")).toBe("lib");
  });

  it("falls back to the input when there are no segments", () => {
    expect(changedFileName("")).toBe("");
    expect(changedFileName("/")).toBe("/");
  });
});

describe("summarizeChangedFileScopes", () => {
  it("tallies by top-level directory, busiest first", () => {
    const scopes = summarizeChangedFileScopes([
      file("src/a.ts"),
      file("tests/b.ts"),
      file("src/c.ts"),
      file("src/d.ts"),
    ]);
    expect(scopes).toEqual([
      { label: "src", fileCount: 3 },
      { label: "tests", fileCount: 1 },
    ]);
  });

  it("groups root-level files under root", () => {
    expect(summarizeChangedFileScopes([file("README.md"), file("package.json")])).toEqual([
      { label: "root", fileCount: 2 },
    ]);
  });

  it("breaks ties by first appearance, not alphabetically", () => {
    const scopes = summarizeChangedFileScopes([file("zeta/a.ts"), file("alpha/b.ts")]);
    expect(scopes.map((scope) => scope.label)).toEqual(["zeta", "alpha"]);
  });

  it("caps the number of scopes", () => {
    const files = ["a", "b", "c", "d", "e", "f"].map((dir) => file(`${dir}/x.ts`));
    expect(summarizeChangedFileScopes(files)).toHaveLength(4);
    expect(summarizeChangedFileScopes(files, 2)).toHaveLength(2);
  });
});

describe("selectChangedFilePreview", () => {
  it("spreads the preview across distinct directories before repeating one", () => {
    const preview = selectChangedFilePreview([
      file("src/a.ts"),
      file("src/b.ts"),
      file("src/c.ts"),
      file("tests/d.ts"),
      file("docs/e.md"),
    ]);
    expect(preview.map((entry) => entry.path)).toEqual(["src/a.ts", "tests/d.ts", "docs/e.md"]);
  });

  it("falls back to document order once every scope is represented", () => {
    const preview = selectChangedFilePreview([file("src/a.ts"), file("src/b.ts"), file("src/c.ts")]);
    expect(preview.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("never duplicates a file", () => {
    const preview = selectChangedFilePreview([file("src/a.ts"), file("tests/b.ts")]);
    expect(new Set(preview.map((entry) => entry.path)).size).toBe(preview.length);
  });

  it("returns everything when there are fewer files than the limit", () => {
    expect(selectChangedFilePreview([file("src/a.ts")])).toHaveLength(1);
    expect(selectChangedFilePreview([])).toEqual([]);
  });
});

describe("shouldAutoExpandChangedFiles", () => {
  it("expands a small, recent turn", () => {
    expect(shouldAutoExpandChangedFiles([file("src/a.ts", 10, 5)], true)).toBe(true);
  });

  it("never expands a turn that is not the latest", () => {
    expect(shouldAutoExpandChangedFiles([file("src/a.ts", 1, 1)], false)).toBe(false);
  });

  it("stays collapsed past the file limit", () => {
    const files = Array.from({ length: CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT + 1 }, (_, index) =>
      file(`src/${index}.ts`, 1, 0),
    );
    expect(shouldAutoExpandChangedFiles(files, true)).toBe(false);
  });

  it("stays collapsed past the changed-line limit", () => {
    expect(shouldAutoExpandChangedFiles([file("src/a.ts", 150, 51)], true)).toBe(false);
    // Exactly at the limit still expands.
    expect(shouldAutoExpandChangedFiles([file("src/a.ts", 150, 50)], true)).toBe(true);
  });
});
