import { describe, expect, it } from "vitest";

import { countDiffLines } from "../../../../apps/desktop/electron/substrate/vcs/diffStats";

/**
 * The Changes header's "+n −n" is read off the patch the Changes list already
 * produced, instead of a second trip through Git. These pin the counting rules
 * that replaced `git diff --shortstat`.
 */
describe("countDiffLines", () => {
  it("counts nothing in an empty patch", () => {
    expect(countDiffLines("")).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts hunk lines and ignores the file headers", () => {
    const patch = [
      "diff --git a/notes.md b/notes.md",
      "index 1234567..89abcde 100644",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,3 +1,3 @@",
      " context",
      "-gone",
      "+added",
      "+also added",
      "",
    ].join("\n");

    expect(countDiffLines(patch)).toEqual({ additions: 2, deletions: 1 });
  });

  it("counts content that looks like a file header", () => {
    // Deleting a line reading `--force` produces `---force`; adding one reading
    // `++x` produces `+++x`. Prefix filtering would drop both.
    const patch = [
      "diff --git a/run.sh b/run.sh",
      "--- a/run.sh",
      "+++ b/run.sh",
      "@@ -1,2 +1,2 @@",
      "---force",
      "+++x",
      "",
    ].join("\n");

    expect(countDiffLines(patch)).toEqual({ additions: 1, deletions: 1 });
  });

  it("sums across several files", () => {
    const patch = [
      "diff --git a/one.ts b/one.ts",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1,2 @@",
      " keep",
      "+one",
      "diff --git a/two.ts b/two.ts",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1,2 +1 @@",
      "-two",
      "-three",
      "",
    ].join("\n");

    expect(countDiffLines(patch)).toEqual({ additions: 1, deletions: 2 });
  });

  it("reports zero for a binary file, as --shortstat does", () => {
    const patch = [
      "diff --git a/logo.png b/logo.png",
      "index 1234567..89abcde 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n");

    expect(countDiffLines(patch)).toEqual({ additions: 0, deletions: 0 });
  });
});
