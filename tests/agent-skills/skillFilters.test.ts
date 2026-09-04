import { describe, expect, it } from "vitest";

import {
  skillMatchesProvider,
  skillMatchesStatus,
} from "../../apps/desktop/src/features/projects/pages/AgentSkillsPage";
import type {
  AgentSkillProvider,
  AgentSkillProviderBinding,
  AgentSkillRecord,
} from "../../shared/electronApiTypes";

function binding(
  provider: AgentSkillProvider,
  state: Partial<AgentSkillProviderBinding>,
): AgentSkillProviderBinding {
  return {
    provider,
    compatible: true,
    enabled: false,
    ownership: "none",
    path: null,
    restartBehavior: "live",
    ...state,
  };
}

function skill(overrides: Partial<AgentSkillRecord>): AgentSkillRecord {
  return {
    id: "s",
    slug: "s",
    name: "s",
    description: "",
    instructions: "",
    source: "external",
    editable: false,
    path: "/tmp/s",
    createdAt: null,
    updatedAt: 0,
    category: "other",
    categoryDeclared: false,
    updateSource: "none",
    bindings: [],
    ...overrides,
  };
}

describe("the provider rows in the sidebar", () => {
  it("lists a skill the provider already loads", () => {
    const installed = skill({ bindings: [binding("claude", { enabled: true })] });
    expect(skillMatchesProvider(installed, "claude")).toBe(true);
    expect(skillMatchesProvider(installed, "cursor")).toBe(false);
  });

  it("also lists one sitting in that provider's catalog, not just the installed ones", () => {
    const installable = skill({
      source: "catalog",
      bindings: [binding("claude", { available: true })],
    });
    expect(skillMatchesProvider(installable, "claude")).toBe(true);
  });

  it("does not leak a catalog skill into an unrelated provider", () => {
    const installable = skill({
      source: "catalog",
      bindings: [binding("claude", { available: true }), binding("codex", {})],
    });
    expect(skillMatchesProvider(installable, "codex")).toBe(false);
  });

  it("passes everything through when no provider is selected", () => {
    expect(skillMatchesProvider(skill({}), null)).toBe(true);
  });
});

describe("the installed / not installed menu", () => {
  const installed = skill({ source: "external" });
  const mine = skill({ source: "managed" });
  const installable = skill({ source: "catalog" });

  it("splits on whether the provider actually loads the skill", () => {
    expect(skillMatchesStatus(installed, "installed")).toBe(true);
    expect(skillMatchesStatus(mine, "installed")).toBe(true);
    expect(skillMatchesStatus(installable, "installed")).toBe(false);

    expect(skillMatchesStatus(installable, "available")).toBe(true);
    expect(skillMatchesStatus(installed, "available")).toBe(false);
  });

  it("keeps everything under All", () => {
    for (const candidate of [installed, mine, installable]) {
      expect(skillMatchesStatus(candidate, "all")).toBe(true);
    }
  });
});
