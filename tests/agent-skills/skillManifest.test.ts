import { describe, expect, it } from "vitest";

import {
  parseSkillMarkdown,
  renderSkillMarkdown,
  slugifySkillName,
} from "../../apps/desktop/electron/services/agentSkills/skillManifest";

describe("agent skill manifests", () => {
  it("normalizes display names into portable provider slugs", () => {
    expect(slugifySkillName("  Réview Pull Requests!  ")).toBe("review-pull-requests");
  });

  it("round-trips the portable SKILL.md fields", () => {
    const markdown = renderSkillMarkdown({
      name: "Review Pull Requests",
      description: "Use when a pull request needs a careful review.",
      instructions: "Inspect the diff.\n\nReport only actionable findings.",
    });

    expect(parseSkillMarkdown(markdown)).toEqual({
      name: "review-pull-requests",
      description: "Use when a pull request needs a careful review.",
      instructions: "Inspect the diff.\n\nReport only actionable findings.",
    });
  });

  it("reads a folded block-scalar description, as real skills write them", () => {
    const markdown = [
      "---",
      "name: autopilot",
      "description: >-",
      "  Keep a PR merge-ready by triaging comments, resolving clear conflicts, and",
      "  fixing CI in a loop.",
      "metadata:",
      "  surfaces:",
      "    - ide",
      "---",
      "",
      "# Autopilot",
    ].join("\n");

    const parsed = parseSkillMarkdown(markdown);
    expect(parsed.name).toBe("autopilot");
    expect(parsed.description).toBe(
      "Keep a PR merge-ready by triaging comments, resolving clear conflicts, and fixing CI in a loop.",
    );
    expect(parsed.instructions).toBe("# Autopilot");
  });

  it("keeps the line breaks of a literal block scalar", () => {
    const markdown = ["---", "name: x", "description: |", "  first", "  second", "---", "", "Body"].join(
      "\n",
    );
    expect(parseSkillMarkdown(markdown).description).toBe("first\nsecond");
  });

  it("does not mistake an indented key for a top-level one", () => {
    const markdown = [
      "---",
      "name: nested",
      "metadata:",
      "  description: the wrong one",
      "---",
      "",
      "Body",
    ].join("\n");
    expect(parseSkillMarkdown(markdown).description).toBe("");
  });

  it("treats an empty quoted description as empty", () => {
    const markdown = ["---", "name: canvas", "description: ''", "---", "", "Body"].join("\n");
    expect(parseSkillMarkdown(markdown).description).toBe("");
  });

  it("keeps plain markdown usable when frontmatter is absent", () => {
    expect(parseSkillMarkdown("# Instructions\n\nDo the work.", "plain-skill")).toEqual({
      name: "plain-skill",
      description: "",
      instructions: "# Instructions\n\nDo the work.",
    });
  });
});
