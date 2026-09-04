import { describe, expect, it } from "vitest";

import {
  AGENT_SKILL_CATEGORIES,
  agentSkillCategoryLabel,
  agentSkillCategoryOrder,
  inferAgentSkillCategory,
  normalizeAgentSkillCategory,
  resolveAgentSkillCategory,
} from "../../shared/agentSkillCategories";

describe("agent skill categories", () => {
  it("keeps Other last so unplaced skills sink to the bottom of the page", () => {
    const last = AGENT_SKILL_CATEGORIES[AGENT_SKILL_CATEGORIES.length - 1];
    expect(last.id).toBe("other");
    expect(agentSkillCategoryOrder("other")).toBe(AGENT_SKILL_CATEGORIES.length - 1);
    expect(agentSkillCategoryOrder("memory")).toBeLessThan(agentSkillCategoryOrder("other"));
  });

  it("accepts a declared category as an id, a label, or a keyword", () => {
    expect(normalizeAgentSkillCategory("testing")).toBe("testing");
    expect(normalizeAgentSkillCategory("Testing & QA")).toBe("testing");
    expect(normalizeAgentSkillCategory("  Documentation  ")).toBe("docs");
    expect(normalizeAgentSkillCategory("figma")).toBe("design");
    expect(normalizeAgentSkillCategory("not-a-category")).toBeNull();
    expect(normalizeAgentSkillCategory(undefined)).toBeNull();
  });

  it("places undeclared skills from their name and description", () => {
    expect(
      inferAgentSkillCategory({
        name: "memory-skill",
        description: "Build and maintain this project's memory map.",
      }),
    ).toBe("memory");
    expect(
      inferAgentSkillCategory({
        name: "code-review",
        description: "Review a change before it merges.",
      }),
    ).toBe("code");
    expect(
      inferAgentSkillCategory({
        name: "Nothing in particular",
        description: "An entirely unremarkable helper.",
      }),
    ).toBe("other");
  });

  it("weighs the name above the description when the two disagree", () => {
    expect(
      inferAgentSkillCategory({
        name: "deploy-checklist",
        description: "Confirm the code review happened first.",
      }),
    ).toBe("ops");
  });

  it("prefers a declared category over an inferred one", () => {
    expect(
      resolveAgentSkillCategory("workflow", {
        name: "deploy-checklist",
        description: "Ship a release.",
      }),
    ).toBe("workflow");
    expect(
      resolveAgentSkillCategory("nonsense", {
        name: "deploy-checklist",
        description: "Ship a release.",
      }),
    ).toBe("ops");
  });

  it("labels every category, and falls back to Other for an unknown id", () => {
    for (const category of AGENT_SKILL_CATEGORIES) {
      expect(agentSkillCategoryLabel(category.id)).toBe(category.label);
    }
    expect(agentSkillCategoryLabel("made-up")).toBe("Other");
  });
});
