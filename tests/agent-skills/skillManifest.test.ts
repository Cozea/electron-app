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

  it("keeps plain markdown usable when frontmatter is absent", () => {
    expect(parseSkillMarkdown("# Instructions\n\nDo the work.", "plain-skill")).toEqual({
      name: "plain-skill",
      description: "",
      instructions: "# Instructions\n\nDo the work.",
    });
  });
});
