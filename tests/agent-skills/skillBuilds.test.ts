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

/** Writes an external skill straight into a provider's own folder. */
function makeExternalSkill(relativeRoot: string, slug: string) {
  const dir = path.join(homeRoot, relativeRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: The ${slug} skill.\n---\n\nDo it.\n`,
    "utf8",
  );
  return dir;
}

describe("skills the provider owns and restores", () => {
  it("refuses to disable a skill from the provider's own bundled folder", async () => {
    makeExternalSkill(".cursor/skills-cursor", "autopilot");
    const svc = service();
    const skill = svc.list().skills.find((s) => s.slug === "autopilot")!;

    expect(skill.bindings.some((b) => b.provider === "cursor" && b.essential)).toBe(true);

    const result = await svc.setEnabled({ skillId: skill.id, enabled: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot disable/i);
    // Still on disk: Cozea did not move a folder the provider would restore.
    expect(fs.existsSync(path.join(homeRoot, ".cursor/skills-cursor/autopilot"))).toBe(true);
  });

  it("refuses to delete a skill the provider restores", async () => {
    makeExternalSkill(".cursor/skills-cursor", "autopilot");
    const svc = service();
    const skill = svc.list().skills.find((s) => s.slug === "autopilot")!;

    const result = await svc.remove(skill.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot delete/i);
    expect(fs.existsSync(path.join(homeRoot, ".cursor/skills-cursor/autopilot"))).toBe(true);
  });

  it("leaves essential skills alone when a build is applied", async () => {
    makeExternalSkill(".cursor/skills-cursor", "autopilot");
    makeExternalSkill(".cursor/skills", "mine");
    const svc = service();
    const mine = svc.list().skills.find((s) => s.slug === "mine")!.id;

    const saved = await svc.saveBuild({ name: "Mine only", skillIds: [mine] });
    const applied = await svc.applyBuild(saved.skillId!);

    expect(applied.success).toBe(true);
    expect(fs.existsSync(path.join(homeRoot, ".cursor/skills-cursor/autopilot"))).toBe(true);
  });

  it("drops a stale disabled record once the skill is back at its original path", async () => {
    // Legacy state: skills disabled before Cozea knew the provider restores
    // them. The live copy is the truth, so the record has to go.
    const original = makeExternalSkill(".cursor/skills", "restored");
    const svc = service();
    const id = svc.list().skills.find((s) => s.slug === "restored")!.id;

    await svc.setEnabled({ skillId: id, enabled: false });
    expect(fs.existsSync(original)).toBe(false);

    makeExternalSkill(".cursor/skills", "restored");

    const skill = svc.list().skills.find((s) => s.slug === "restored")!;
    expect(skill.bindings.some((b) => b.provider === "cursor" && b.enabled)).toBe(true);
    const again = await svc.setEnabled({ skillId: skill.id, enabled: false });
    expect(again.success).toBe(true);
  });
});

describe("applying a build to skills the providers own", () => {
  it("disables the external skills a build leaves out", async () => {
    makeExternalSkill(".claude/skills", "alpha");
    makeExternalSkill(".claude/skills", "beta");
    makeExternalSkill(".codex/skills", "gamma");
    const svc = service();

    const before = svc.list().skills;
    const alpha = before.find((s) => s.slug === "alpha")!.id;
    expect(before.filter((s) => s.bindings.some((b) => b.enabled))).toHaveLength(3);

    const saved = await svc.saveBuild({ name: "Alpha only", skillIds: [alpha] });
    const applied = await svc.applyBuild(saved.skillId!);

    const enabled = applied.snapshot.skills
      .filter((skill) => skill.bindings.some((binding) => binding.enabled))
      .map((skill) => skill.slug);
    expect(enabled).toEqual(["alpha"]);
    expect(applied.success).toBe(true);
  });

  it("re-enables a one-provider skill without reporting the other three as failures", async () => {
    // Every binding is marked compatible, so switching a skill on asks all
    // four providers. Only Claude ever had this one, so the other three have
    // nothing to restore, and that must not read as an error.
    makeExternalSkill(".claude/skills", "alpha");
    const svc = service();
    const alpha = svc.list().skills.find((s) => s.slug === "alpha")!.id;

    const off = await svc.setEnabled({ skillId: alpha, enabled: false });
    expect(off.success).toBe(true);

    const on = await svc.setEnabled({ skillId: alpha, enabled: true });
    expect(on.success).toBe(true);
    expect(on.error).toBeUndefined();

    const bindings = on.snapshot.skills.find((s) => s.slug === "alpha")!.bindings;
    expect(bindings.filter((b) => b.enabled).map((b) => b.provider)).toEqual(["claude"]);
  });

  it("forgets a disabled skill whose trashed copy has gone", async () => {
    // The record is only meaningful while the copy exists, so `list` drops it
    // rather than leaving an enable that could never succeed.
    makeExternalSkill(".claude/skills", "beta");
    const svc = service();
    const beta = svc.list().skills.find((s) => s.slug === "beta")!.id;
    await svc.setEnabled({ skillId: beta, enabled: false });

    const state = JSON.parse(
      fs.readFileSync(path.join(dataRoot, "state.json"), "utf8"),
    ) as { disabledExternalBindings: Array<{ trashPath: string }> };
    fs.rmSync(state.disabledExternalBindings[0]!.trashPath, { recursive: true, force: true });

    expect(svc.list().skills.some((s) => s.slug === "beta")).toBe(false);
  });

  it("does not spread a build's skills onto providers that never had them", async () => {
    makeExternalSkill(".claude/skills", "alpha");
    makeExternalSkill(".codex/skills", "gamma");
    const svc = service();
    const alpha = svc.list().skills.find((s) => s.slug === "alpha")!.id;

    const saved = await svc.saveBuild({ name: "Alpha only", skillIds: [alpha] });
    const applied = await svc.applyBuild(saved.skillId!);

    const onProviders = applied.snapshot.skills
      .find((s) => s.slug === "alpha")!
      .bindings.filter((b) => b.enabled)
      .map((b) => b.provider);
    expect(onProviders).toEqual(["claude"]);
  });
});

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
  cozeaSkills,
  filterPickerSkills,
  buildableSkills,
  needsInstall,
  partitionEssential,
  providerEssentialCount,
  resolveSelectedBuild,
  loadoutByCategory,
  providerCandidates,
  providerLoadout,
  providerSkillCounts,
  stepDetail,
  toggleCategorySelection,
} from "../../apps/desktop/src/features/projects/pages/SkillBuildsView";
import type { AgentSkillRecord } from "../../shared/electronApiTypes";

function record(
  id: string,
  category: string,
  source: AgentSkillRecord["source"],
  installedOn: AgentSkillRecord["bindings"][number]["provider"][] = [],
): AgentSkillRecord {
  return {
    id, slug: id, name: id, description: "", instructions: "",
    source, editable: false, path: `/tmp/${id}`, createdAt: null, updatedAt: 0,
    category, categoryDeclared: false, updateSource: "none",
    bindings: installedOn.map((provider) => ({
      provider, compatible: true, enabled: true, ownership: "external" as const,
      path: `/tmp/${provider}/${id}`, restartBehavior: "live" as const,
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

  it("draws on catalog entries too, since a plate counts what a provider can run", () => {
    expect(buildableSkills(library).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("marks a catalog entry as needing an install before a build can hold it", () => {
    expect(needsInstall(library[3]!)).toBe(true);
    expect(library.slice(0, 3).some(needsInstall)).toBe(false);
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
 * The hub's buckets partition a build by whose skill it is: the core holds the
 * Cozea library, a plate holds that provider's own. A library skill installed
 * into every provider still belongs only to the core, so nothing is listed
 * twice.
 *
 * Ownership decides the plates, not compatibility: every skill is marked
 * compatible with every provider, so compatibility cannot tell them apart.
 */
describe("what each bucket of a build holds", () => {
  const everywhere = ["claude", "codex", "cursor", "opencode"] as const;
  const loadout = [
    record("library", "code", "managed", [...everywhere]),
    record("pair", "code", "external", ["claude", "codex"]),
    record("b", "code", "external", ["claude"]),
    record("c", "design", "external", ["cursor"]),
  ];

  it("counts a provider's own skills, in a stable order", () => {
    expect(providerSkillCounts(loadout)).toEqual([
      { provider: "claude", label: "Claude", count: 2 },
      { provider: "codex", label: "Codex", count: 1 },
      { provider: "cursor", label: "Cursor", count: 1 },
      { provider: "opencode", label: "OpenCode", count: 0 },
    ]);
  });

  it("treats the core as the Cozea library, not the shared set", () => {
    expect(cozeaSkills(loadout).map((s) => s.id)).toEqual(["library"]);
  });

  it("keeps a library skill off the plates it was installed into", () => {
    // "library" reaches every provider's folder, but it is listed once, in
    // the core — repeating it on four plates is what the partition avoids.
    for (const provider of everywhere) {
      expect(providerLoadout(loadout, provider).map((s) => s.id)).not.toContain("library");
    }
  });

  it("lists only the provider's own skills", () => {
    expect(providerLoadout(loadout, "claude").map((s) => s.id)).toEqual(["pair", "b"]);
    expect(providerLoadout(loadout, "opencode")).toEqual([]);
  });

  it("leaves no skill without a page", () => {
    const buckets = [
      ...cozeaSkills(loadout),
      ...everywhere.flatMap((provider) => providerLoadout(loadout, provider)),
    ].map((skill) => skill.id);
    expect(new Set(buckets)).toEqual(new Set(["library", "pair", "b", "c"]));
  });

  it("still shows a provider-owned skill on each provider that installed it", () => {
    // Only library skills are pulled out to one page. "pair" is Claude's and
    // Codex's alike, so both plates list it — that is not duplication.
    expect(providerLoadout(loadout, "claude").map((s) => s.id)).toContain("pair");
    expect(providerLoadout(loadout, "codex").map((s) => s.id)).toContain("pair");
  });

  it("reports zero for every provider on an empty build", () => {
    expect(providerSkillCounts([]).every((node) => node.count === 0)).toBe(true);
    expect(cozeaSkills([])).toEqual([]);
  });
});

/**
 * A and D page between the hub's buckets. The core is part of the ring, not a
 * dead end: landing on it and pressing D must keep moving.
 */
describe("paging between hub buckets", () => {
  it("walks the ring forward from the core through every agent", () => {
    expect(stepDetail("cozea", 1)).toBe("claude");
    expect(stepDetail("claude", 1)).toBe("codex");
    expect(stepDetail("codex", 1)).toBe("cursor");
    expect(stepDetail("cursor", 1)).toBe("opencode");
  });

  it("wraps at both ends rather than stopping", () => {
    expect(stepDetail("opencode", 1)).toBe("cozea");
    expect(stepDetail("cozea", -1)).toBe("opencode");
  });

  it("is reversible from anywhere in the ring", () => {
    for (const bucket of ["cozea", "claude", "codex", "cursor", "opencode"] as const) {
      expect(stepDetail(stepDetail(bucket, 1), -1)).toBe(bucket);
    }
  });
});

/**
 * The page's pick-list is not the plate's contents. A plate counts what the
 * build holds for that provider, on or off; the page offers what the provider
 * can run right now — the same rule the Agent Skills page uses, so the two
 * screens report the same number of skills per provider.
 */
describe("what a provider page offers to pick from", () => {
  function binding(
    provider: AgentSkillRecord["bindings"][number]["provider"],
    state: { enabled?: boolean; available?: boolean; owned?: boolean },
  ): AgentSkillRecord["bindings"][number] {
    return {
      provider,
      compatible: true,
      enabled: state.enabled ?? false,
      ownership: state.owned ? ("external" as const) : ("none" as const),
      path: state.owned ? "/tmp/x" : null,
      restartBehavior: "live" as const,
      ...(state.available === undefined ? {} : { available: state.available }),
    };
  }
  function skill(id: string, source: AgentSkillRecord["source"], bindings: AgentSkillRecord["bindings"]) {
    return { ...record(id, "code", source), bindings } as AgentSkillRecord;
  }

  const loaded = skill("loaded", "external", [binding("claude", { enabled: true, owned: true })]);
  const offered = skill("offered", "catalog", [binding("claude", { available: true })]);
  const turnedOff = skill("off", "external", [binding("claude", { owned: true })]);
  const library = skill("library", "managed", [binding("claude", { enabled: true, owned: true })]);
  const all = [loaded, offered, turnedOff, library];

  it("offers what the provider can run, loaded or from its catalog", () => {
    expect(providerCandidates(all, "claude", new Set()).map((s) => s.id)).toEqual([
      "loaded",
      "offered",
    ]);
  });

  it("leaves the Cozea library to its own page", () => {
    expect(providerCandidates(all, "claude", new Set(["library"])).map((s) => s.id)).not.toContain(
      "library",
    );
  });

  it("keeps a switched-off skill the build holds, so it can still be unticked", () => {
    // Activating a build switches off what it excludes. Without this, a build
    // could hold a skill that had vanished from the only page that edits it.
    expect(providerCandidates(all, "claude", new Set(["off"])).map((s) => s.id)).toContain("off");
    expect(providerCandidates(all, "claude", new Set()).map((s) => s.id)).not.toContain("off");
  });
});

/**
 * Some skills ship with the provider, which rewrites the folder they live in.
 * A build cannot switch those off, so the page reports them instead of
 * offering a tick it could not honour.
 */
describe("skills a build cannot control", () => {
  function withEssential(id: string, essential: boolean): AgentSkillRecord {
    const base = record(id, "code", "external", ["cursor"]);
    return {
      ...base,
      bindings: base.bindings.map((b) => ({ ...b, ...(essential ? { essential: true } : {}) })),
    };
  }
  const skills = [withEssential("mine", false), withEssential("bundled", true)];

  it("separates what a build can choose from what it cannot", () => {
    const { choosable, essential } = partitionEssential(skills);
    expect(choosable.map((s) => s.id)).toEqual(["mine"]);
    expect(essential.map((s) => s.id)).toEqual(["bundled"]);
  });

  it("keeps every skill in one side or the other", () => {
    const { choosable, essential } = partitionEssential(skills);
    expect(choosable.length + essential.length).toBe(skills.length);
  });

  it("counts what a provider always runs, per provider", () => {
    // The plate would otherwise report a Cursor running one skill while it
    // actually loads the bundled set it restores on its own.
    expect(providerEssentialCount(skills, "cursor")).toBe(1);
    expect(providerEssentialCount(skills, "claude")).toBe(0);
    expect(providerEssentialCount([], "cursor")).toBe(0);
  });

  it("treats a skill with no essential binding as choosable", () => {
    expect(partitionEssential([]).essential).toEqual([]);
    expect(partitionEssential([withEssential("plain", false)]).choosable).toHaveLength(1);
  });
});

/**
 * The hub draws one build. Anything that clears the selection, starting a new
 * build and cancelling most of all, must not leave it with nothing to draw.
 */
describe("which build the hub shows", () => {
  const builds = [
    { id: "a", name: "A", skillIds: [], createdAt: 0, updatedAt: 0 },
    { id: "b", name: "B", skillIds: [], createdAt: 0, updatedAt: 0 },
  ];

  it("shows the selected build", () => {
    expect(resolveSelectedBuild(builds, "b", "a")?.id).toBe("b");
  });

  it("falls back to the active build when the selection is cleared", () => {
    // "New build" clears the selection; cancelling used to leave a blank page.
    expect(resolveSelectedBuild(builds, null, "b")?.id).toBe("b");
  });

  it("falls back to the first build when nothing is selected or active", () => {
    expect(resolveSelectedBuild(builds, null, null)?.id).toBe("a");
  });

  it("falls back when the selection points at a build that has gone", () => {
    expect(resolveSelectedBuild(builds, "deleted", null)?.id).toBe("a");
  });

  it("resolves to nothing only when there are no builds", () => {
    expect(resolveSelectedBuild([], "a", "a")).toBeNull();
  });
});
