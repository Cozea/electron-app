import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isReady: () => false, getPath: () => "/tmp/cozea-builds-test" },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import {
  AgentSkillService,
  findActiveBuildId,
  planBuildApplication,
} from "../../apps/desktop/electron/services/AgentSkillService";

let testRoot = "";
let dataRoot = "";
let homeRoot = "";

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-builds-"));
  dataRoot = path.join(testRoot, "data");
  homeRoot = path.join(testRoot, "home");
  fs.mkdirSync(homeRoot, { recursive: true });
});
afterEach(() => fs.rmSync(testRoot, { recursive: true, force: true }));

const service = () => new AgentSkillService({ dataRoot, homeRoot });

async function makeSkill(name: string) {
  const created = await service().save({
    name,
    description: `The ${name} skill.`,
    instructions: "Do it.",
    compatibleProviders: ["claude"],
  });
  return created.skillId!;
}

describe("what applying a build has to change", () => {
  it("turns on what is missing and off what is extra", () => {
    const plan = planBuildApplication({ skillIds: ["a", "b"] }, [
      { id: "a", enabled: true },
      { id: "b", enabled: false },
      { id: "c", enabled: true },
      { id: "d", enabled: false },
    ]);
    expect(plan.enable).toEqual(["b"]);
    expect(plan.disable).toEqual(["c"]);
  });

  it("does nothing when the build is already what is on", () => {
    const plan = planBuildApplication({ skillIds: ["a"] }, [
      { id: "a", enabled: true },
      { id: "b", enabled: false },
    ]);
    expect(plan).toEqual({ enable: [], disable: [] });
  });

  it("turns everything off for an empty build", () => {
    const plan = planBuildApplication({ skillIds: [] }, [
      { id: "a", enabled: true },
      { id: "b", enabled: true },
    ]);
    expect(plan.disable).toEqual(["a", "b"]);
  });
});

describe("which build counts as active", () => {
  const known = new Set(["a", "b", "c"]);
  const builds = [
    { id: "one", name: "One", skillIds: ["a", "b"], createdAt: 0, updatedAt: 0 },
    { id: "two", name: "Two", skillIds: ["a"], createdAt: 0, updatedAt: 0 },
  ];

  it("matches a build only when the enabled set is exactly its own", () => {
    expect(findActiveBuildId(builds, ["a", "b"], known)).toBe("one");
    expect(findActiveBuildId(builds, ["a"], known)).toBe("two");
  });

  it("claims nothing when an extra skill is on beyond the build", () => {
    expect(findActiveBuildId(builds, ["a", "b", "c"], known)).toBeNull();
  });

  it("ignores skills a build names that no longer exist", () => {
    const stale = [{ id: "s", name: "S", skillIds: ["a", "gone"], createdAt: 0, updatedAt: 0 }];
    expect(findActiveBuildId(stale, ["a"], known)).toBe("s");
  });
});

describe("saving and applying a build end to end", () => {
  it("saves a named build and reports it in the snapshot", async () => {
    const first = await makeSkill("alpha");
    const svc = service();
    const saved = await svc.saveBuild({ name: "  Writing docs  ", skillIds: [first] });

    expect(saved.success).toBe(true);
    expect(saved.snapshot.builds).toHaveLength(1);
    expect(saved.snapshot.builds[0]).toMatchObject({ name: "Writing docs", skillIds: [first] });
  });

  it("refuses a build with no name", async () => {
    const result = await service().saveBuild({ name: "   ", skillIds: [] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it("drops skill ids that do not resolve", async () => {
    const real = await makeSkill("alpha");
    const saved = await service().saveBuild({ name: "Mixed", skillIds: [real, "ghost"] });
    expect(saved.snapshot.builds[0].skillIds).toEqual([real]);
  });

  it("enables exactly the build's skills and disables the rest", async () => {
    const alpha = await makeSkill("alpha");
    const beta = await makeSkill("beta");
    const svc = service();

    // Start with beta on and alpha off — the opposite of the build.
    await svc.setEnabled({ skillId: beta, enabled: true });

    const saved = await svc.saveBuild({ name: "Alpha only", skillIds: [alpha] });
    const applied = await svc.applyBuild(saved.skillId!);

    expect(applied.success).toBe(true);
    const enabled = applied.snapshot.skills
      .filter((skill) => skill.bindings.some((binding) => binding.enabled))
      .map((skill) => skill.id);
    expect(enabled).toEqual([alpha]);
    expect(applied.snapshot.activeBuildId).toBe(saved.skillId);
  });

  it("stops reporting a build as active once a skill is toggled beyond it", async () => {
    const alpha = await makeSkill("alpha");
    const beta = await makeSkill("beta");
    const svc = service();
    const saved = await svc.saveBuild({ name: "Alpha only", skillIds: [alpha] });
    await svc.applyBuild(saved.skillId!);

    const after = await svc.setEnabled({ skillId: beta, enabled: true });
    expect(after.snapshot.activeBuildId).toBeNull();
  });

  it("deletes a build without touching which skills are on", async () => {
    const alpha = await makeSkill("alpha");
    const svc = service();
    const saved = await svc.saveBuild({ name: "Alpha", skillIds: [alpha] });
    await svc.applyBuild(saved.skillId!);

    const deleted = await svc.deleteBuild(saved.skillId!);
    expect(deleted.snapshot.builds).toHaveLength(0);
    expect(
      deleted.snapshot.skills.find((s) => s.id === alpha)?.bindings.some((b) => b.enabled),
    ).toBe(true);
  });
});

import {
  buildLoadout,
  filterPickerSkills,
  installedSkills,
  loadoutByCategory,
  providerLoadout,
  providerSkillCounts,
  toggleCategorySelection,
} from "../../apps/desktop/src/features/projects/pages/SkillBuildsView";
import type { AgentSkillRecord } from "../../shared/electronApiTypes";

function record(
  id: string,
  category: string,
  source: AgentSkillRecord["source"],
  compatibleWith: AgentSkillRecord["bindings"][number]["provider"][] = [],
): AgentSkillRecord {
  return {
    id, slug: id, name: id, description: "", instructions: "",
    source, editable: false, path: `/tmp/${id}`, createdAt: null, updatedAt: 0,
    category, categoryDeclared: false, updateSource: "none",
    bindings: compatibleWith.map((provider) => ({
      provider, compatible: true, enabled: false, ownership: "none" as const,
      path: null, restartBehavior: "live" as const,
    })),
  };
}

/**
 * A build shows only what it contains — that is the point of the page — so the
 * sheet is built from the build's own ids rather than by filtering the library.
 */
describe("what a build sheet shows", () => {
  const library = [
    record("a", "code", "managed"),
    record("b", "code", "external"),
    record("c", "design", "external"),
    record("d", "design", "catalog"),
  ];

  it("draws only from skills that are actually installed", () => {
    expect(installedSkills(library).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("lists exactly the build's skills, in library order", () => {
    expect(buildLoadout({ skillIds: ["c", "a"] }, library).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("silently drops ids whose skill has been removed", () => {
    expect(buildLoadout({ skillIds: ["a", "gone"] }, library).map((s) => s.id)).toEqual(["a"]);
  });

  it("shows nothing for an empty build rather than the whole library", () => {
    expect(buildLoadout({ skillIds: [] }, library)).toEqual([]);
  });

  it("groups the loadout into its categories", () => {
    const groups = loadoutByCategory(buildLoadout({ skillIds: ["a", "b", "c"] }, library));
    expect(groups.map((g) => [g.label, g.skills.length])).toEqual([
      ["Coding & Review", 2],
      ["Design & UI", 1],
    ]);
  });
});

/**
 * The picker draws from every installed skill, so browsing it by category
 * beats scrolling the whole library looking for one.
 */
describe("finding skills to add to a build", () => {
  const library = [
    record("a", "code", "external"),
    record("b", "code", "external"),
    record("c", "design", "external"),
    record("d", "memory", "external"),
  ];

  it("narrows to a single category", () => {
    expect(filterPickerSkills(library, "", "code").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("searches across every category when none is chosen", () => {
    expect(filterPickerSkills(library, "c", null).map((s) => s.id)).toEqual(["c"]);
  });

  it("applies the search within the chosen category only", () => {
    expect(filterPickerSkills(library, "a", "design")).toEqual([]);
  });

  it("orders the groups by the category taxonomy, not by first appearance", () => {
    expect(loadoutByCategory(library).map((g) => g.category)).toEqual([
      "memory",
      "code",
      "design",
    ]);
  });
});

describe("selecting a whole category at once", () => {
  it("completes a category that is only partly chosen", () => {
    expect(toggleCategorySelection(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("clears a category that is already fully chosen", () => {
    expect(toggleCategorySelection(["a", "b", "z"], ["a", "b"])).toEqual(["z"]);
  });

  it("leaves other categories untouched", () => {
    expect(toggleCategorySelection(["z"], ["a"])).toEqual(["z", "a"]);
  });

  it("never duplicates a skill already chosen", () => {
    expect(toggleCategorySelection(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("does nothing for an empty category", () => {
    expect(toggleCategorySelection(["a"], [])).toEqual(["a"]);
  });
});

/**
 * The hub shows each provider carrying the number of the build's skills it
 * would run. Compatibility decides that, not what happens to be enabled — a
 * build describes intent, and an incompatible skill can never be part of it.
 */
describe("what each provider runs in a build", () => {
  const loadout = [
    record("a", "code", "external", ["claude", "codex"]),
    record("b", "code", "external", ["claude"]),
    record("c", "design", "external", ["cursor"]),
  ];

  it("counts per provider, in a stable order", () => {
    expect(providerSkillCounts(loadout)).toEqual([
      { provider: "claude", label: "Claude", count: 2 },
      { provider: "codex", label: "Codex", count: 1 },
      { provider: "cursor", label: "Cursor", count: 1 },
      { provider: "opencode", label: "OpenCode", count: 0 },
    ]);
  });

  it("counts a skill once per provider it supports, not once overall", () => {
    const counts = providerSkillCounts(loadout);
    expect(counts.reduce((sum, node) => sum + node.count, 0)).toBe(4);
  });

  it("lists what one provider gets, ready to group", () => {
    expect(providerLoadout(loadout, "claude").map((s) => s.id)).toEqual(["a", "b"]);
    expect(providerLoadout(loadout, "opencode")).toEqual([]);
  });

  it("reports zero for every provider on an empty build", () => {
    expect(providerSkillCounts([]).every((node) => node.count === 0)).toBe(true);
  });
});
