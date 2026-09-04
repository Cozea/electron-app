import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isReady: () => false, getPath: () => "/tmp/cozea-agent-skills-library-test" },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import { AgentSkillService } from "../../apps/desktop/electron/services/AgentSkillService";
import { BUILT_IN_SKILLS } from "../../apps/desktop/electron/services/agentSkills/builtInSkills";

let testRoot = "";
let dataRoot = "";
let homeRoot = "";

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-agent-skills-library-"));
  dataRoot = path.join(testRoot, "data");
  homeRoot = path.join(testRoot, "home");
  fs.mkdirSync(homeRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createService(): AgentSkillService {
  return new AgentSkillService({ dataRoot, homeRoot });
}

function writeSkillFolder(
  folder: string,
  options: { name: string; description: string; category?: string; body: string },
): string {
  fs.mkdirSync(folder, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(options.name)}`,
    `description: ${JSON.stringify(options.description)}`,
    ...(options.category ? [`category: ${JSON.stringify(options.category)}`] : []),
    "---",
    "",
    options.body,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(folder, "SKILL.md"), frontmatter, "utf8");
  return folder;
}

describe("agent skill library shelves", () => {
  it("infers a category when the author declares none, and honours one when they do", async () => {
    const service = createService();
    const inferred = await service.save({
      name: "Review pull requests",
      description: "Review a code change before it merges.",
      instructions: "Inspect the diff.",
      compatibleProviders: ["claude"],
    });
    const declared = await service.save({
      name: "Release notes",
      description: "Summarise what shipped.",
      instructions: "Read the log.",
      compatibleProviders: ["claude"],
      category: "docs",
    });

    const skills = declared.snapshot.skills;
    const reviewer = skills.find((skill) => skill.id === inferred.skillId);
    const notes = skills.find((skill) => skill.id === declared.skillId);

    expect(reviewer).toMatchObject({ category: "code", categoryDeclared: false });
    expect(notes).toMatchObject({ category: "docs", categoryDeclared: true });
    // A declared category is round-tripped through SKILL.md, not only metadata.
    expect(fs.readFileSync(path.join(notes!.path, "SKILL.md"), "utf8")).toContain(
      'category: "docs"',
    );
  });

  it("reads a category out of an external provider skill's frontmatter", () => {
    writeSkillFolder(path.join(homeRoot, ".claude", "skills", "shipit"), {
      name: "shipit",
      description: "Anything at all.",
      category: "Build & Deploy",
      body: "Do the thing.",
    });

    const skill = createService().list().skills[0];
    expect(skill).toMatchObject({
      source: "external",
      category: "ops",
      categoryDeclared: true,
      updateSource: "none",
    });
  });
});

describe("one skill, one row", () => {
  it("merges per-provider copies of the same skill even when their files differ", () => {
    // Real installs tailor each copy: the Claude one names .claude paths, the
    // Cursor one names .cursor paths. Same skill, four different files.
    for (const [root, provider] of [
      [".codex/skills", "codex"],
      [".claude/skills", "claude"],
      [".cursor/skills", "cursor"],
      [".config/opencode/skills", "opencode"],
    ] as const) {
      writeSkillFolder(path.join(homeRoot, ...root.split("/"), "impeccable"), {
        name: "impeccable",
        description: `Polish interfaces. Run scripts from ${provider}.`,
        body: `Load reference from the ${provider} folder.`,
      });
    }

    const skills = createService().list().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0].bindings.filter((binding) => binding.enabled).map((b) => b.provider).sort()).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
    ]);

    // The one page carries each provider's own copy so they stay inspectable.
    const claude = skills[0].bindings.find((binding) => binding.provider === "claude");
    expect(claude?.variant?.instructions).toBe("Load reference from the claude folder.");
    const cursor = skills[0].bindings.find((binding) => binding.provider === "cursor");
    expect(cursor?.variant?.instructions).toBe("Load reference from the cursor folder.");
    // Codex was scanned first, so it defines the canonical text and carries no variant.
    expect(skills[0].instructions).toBe("Load reference from the codex folder.");
    expect(
      skills[0].bindings.find((binding) => binding.provider === "codex")?.variant,
    ).toBeUndefined();
  });

  it("leaves identical provider copies without a variant", () => {
    for (const root of [".claude/skills", ".cursor/skills"] as const) {
      writeSkillFolder(path.join(homeRoot, ...root.split("/"), "twin"), {
        name: "twin",
        description: "Exactly the same everywhere.",
        body: "One body of instructions.",
      });
    }

    const skill = createService().list().skills[0];
    expect(skill.bindings.every((binding) => binding.variant === undefined)).toBe(true);
  });

  it("re-adopts a provider copy whose marker points at a reseeded library id", async () => {
    const service = createService();
    const created = await service.save({
      name: "memory-skill",
      description: "Maintain the project's memory map.",
      instructions: "Write the graph.",
      compatibleProviders: ["claude"],
    });
    await service.setProviderEnabled({
      skillId: created.skillId!,
      provider: "claude",
      enabled: true,
    });

    // Simulate the library entry having been reseeded under a new id.
    const markerPath = path.join(homeRoot, ".claude", "skills", "memory-skill", ".cozea-skill.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ ...marker, skillId: "skill_gone" }, null, 2),
      "utf8",
    );

    const skills = createService().list().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: created.skillId, source: "managed" });
    expect(
      skills[0].bindings.find((binding) => binding.provider === "claude"),
    ).toMatchObject({ enabled: true, ownership: "managed" });
    // The marker is healed on disk so disabling it no longer trips ownership.
    expect(JSON.parse(fs.readFileSync(markerPath, "utf8")).skillId).toBe(created.skillId);
  });
});

describe("the plugin catalog", () => {
  function writeCatalogSkill(plugin: string, skill: string, description: string): void {
    writeSkillFolder(
      path.join(
        homeRoot,
        ".claude",
        "plugins",
        "marketplaces",
        "official",
        "plugins",
        plugin,
        "skills",
        skill,
      ),
      { name: skill, description, body: `Do the ${plugin} thing.` },
    );
  }

  it("offers uninstalled marketplace skills, kept distinct per plugin", () => {
    writeCatalogSkill("discord", "access", "Manage Discord channel access.");
    writeCatalogSkill("telegram", "access", "Manage Telegram channel access.");

    const skills = createService().list().skills;
    expect(skills).toHaveLength(2);
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      "discord:access",
      "telegram:access",
    ]);
    for (const skill of skills) {
      expect(skill.source).toBe("catalog");
      expect(skill.bindings.find((b) => b.provider === "claude")).toMatchObject({
        available: true,
        enabled: false,
      });
      // A catalog skill is not loaded by anything yet.
      expect(skill.bindings.some((binding) => binding.enabled)).toBe(false);
    }
  });

  it("installs a catalog skill into the provider's own skills folder", async () => {
    writeCatalogSkill("skill-creator", "skill-creator", "Author new skills.");
    const service = createService();
    const catalogSkill = service.list().skills[0];

    const result = await service.install(catalogSkill.id);
    expect(result.success).toBe(true);
    expect(
      fs.existsSync(path.join(homeRoot, ".claude", "skills", "skill-creator", "SKILL.md")),
    ).toBe(true);

    // It becomes one ordinary installed row, not a second entry beside the catalog.
    expect(result.snapshot.skills).toHaveLength(1);
    expect(result.snapshot.skills[0]).toMatchObject({ source: "external" });
    expect(
      result.snapshot.skills[0].bindings.find((b) => b.provider === "claude")?.enabled,
    ).toBe(true);
  });

  it("hides a catalog skill that is already installed", () => {
    writeCatalogSkill("frontend-design", "frontend-design", "Visual design guidance.");
    writeSkillFolder(path.join(homeRoot, ".claude", "skills", "frontend-design"), {
      name: "frontend-design",
      description: "Visual design guidance.",
      body: "Already here.",
    });

    const skills = createService().list().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe("external");
  });

  it("refuses to install something that is not in a catalog", async () => {
    const service = createService();
    const created = await service.save({
      name: "Mine",
      description: "Already mine.",
      instructions: "Do it.",
      compatibleProviders: ["claude"],
    });
    const result = await service.install(created.skillId!);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already installed/i);
  });
});

describe("Codex's plugin cache", () => {
  function writeCodexCatalogSkill(
    marketplace: string,
    plugin: string,
    version: string,
    skill: string,
  ): void {
    writeSkillFolder(
      path.join(
        homeRoot,
        ".codex",
        "plugins",
        "cache",
        marketplace,
        plugin,
        version,
        "skills",
        skill,
      ),
      { name: skill, description: `The ${skill} skill.`, body: "Do it." },
    );
  }

  function writeCodexConfig(installed: string[]): void {
    const body = installed.map((name) => `[plugins."${name}"]\nenabled = true\n`).join("\n");
    fs.mkdirSync(path.join(homeRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(homeRoot, ".codex", "config.toml"), body, "utf8");
  }

  it("offers cached plugins Codex has not installed, naming the plugin not the version", () => {
    writeCodexCatalogSkill("openai-curated-remote", "shopify", "4.0.1", "storefront");
    writeCodexConfig([]);

    const skills = createService().list().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "shopify:storefront", source: "catalog" });
    expect(skills[0].originLabel).toBe("shopify · openai-curated-remote");
    expect(skills[0].bindings.find((b) => b.provider === "codex")).toMatchObject({
      available: true,
      enabled: false,
    });
  });

  it("leaves out a plugin Codex already runs, since its skills are live", () => {
    writeCodexCatalogSkill("openai-curated", "github", "11c74d6b", "gh-fix-ci");
    writeCodexCatalogSkill("openai-curated-remote", "shopify", "4.0.1", "storefront");
    writeCodexConfig(["github@openai-curated"]);

    const skills = createService().list().skills;
    expect(skills.map((skill) => skill.name)).toEqual(["shopify:storefront"]);
  });

  it("treats a plugin disabled in config as installable again", () => {
    writeCodexCatalogSkill("openai-curated", "github", "11c74d6b", "gh-fix-ci");
    fs.writeFileSync(
      path.join(homeRoot, ".codex", "config.toml"),
      '[plugins."github@openai-curated"]\nenabled = false\n',
      "utf8",
    );
    expect(createService().list().skills.map((skill) => skill.name)).toEqual([
      "github:gh-fix-ci",
    ]);
  });

  it("represents a plugin cached at several versions by its newest", () => {
    writeCodexCatalogSkill("personal", "tool", "1.0.0", "run");
    writeCodexCatalogSkill("personal", "tool", "10.2.0", "run");
    writeCodexConfig([]);

    const skills = createService().list().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0].path).toContain(path.join("tool", "10.2.0"));
  });

  it("installs a Codex catalog skill into ~/.codex/skills", async () => {
    writeCodexCatalogSkill("openai-curated-remote", "shopify", "4.0.1", "storefront");
    writeCodexConfig([]);
    const service = createService();

    const result = await service.install(service.list().skills[0].id);
    expect(result.success).toBe(true);
    expect(
      fs.existsSync(path.join(homeRoot, ".codex", "skills", "storefront", "SKILL.md")),
    ).toBe(true);
  });
});

describe("Codex's primary skills folder", () => {
  it("moves an existing managed copy out of the legacy root", async () => {
    const service = createService();
    const created = await service.save({
      name: "Mover",
      description: "Moves house.",
      instructions: "Do it.",
      compatibleProviders: ["codex"],
    });
    await service.setProviderEnabled({
      skillId: created.skillId!,
      provider: "codex",
      enabled: true,
    });

    // Simulate the pre-migration layout: the copy sitting in ~/.agents/skills.
    const primary = path.join(homeRoot, ".codex", "skills", "mover");
    const legacy = path.join(homeRoot, ".agents", "skills", "mover");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.renameSync(primary, legacy);
    expect(createService().list().skills[0].bindings[0]).toMatchObject({
      provider: "codex",
      enabled: true,
      path: legacy,
    });

    await createService().migrateManagedBindingsToPrimaryRoot();

    expect(fs.existsSync(path.join(primary, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(createService().list().skills[0].bindings[0]).toMatchObject({
      provider: "codex",
      enabled: true,
      path: primary,
    });
  });
});

describe("the library master switch", () => {
  it("enables and disables every compatible provider in one call", async () => {
    const service = createService();
    const created = await service.save({
      name: "Everywhere",
      description: "Reaches every agent.",
      instructions: "Do it.",
      compatibleProviders: ["codex", "claude"],
    });

    const enabled = await service.setEnabled({ skillId: created.skillId!, enabled: true });
    expect(enabled.success).toBe(true);
    expect(enabled.changedProviders?.sort()).toEqual(["claude", "codex"]);
    expect(fs.existsSync(path.join(homeRoot, ".codex", "skills", "everywhere", "SKILL.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(homeRoot, ".claude", "skills", "everywhere", "SKILL.md"))).toBe(
      true,
    );
    expect(enabled.snapshot.skills[0].bindings.filter((binding) => binding.enabled)).toHaveLength(2);

    const disabled = await service.setEnabled({ skillId: created.skillId!, enabled: false });
    expect(disabled.success).toBe(true);
    expect(disabled.snapshot.skills[0].bindings.some((binding) => binding.enabled)).toBe(false);
    expect(fs.existsSync(path.join(homeRoot, ".codex", "skills", "everywhere"))).toBe(false);
  });

  it("never touches a provider the skill is not compatible with", async () => {
    const service = createService();
    const created = await service.save({
      name: "Claude only",
      description: "One provider.",
      instructions: "Do it.",
      compatibleProviders: ["claude"],
    });

    const enabled = await service.setEnabled({ skillId: created.skillId!, enabled: true });
    expect(enabled.changedProviders).toEqual(["claude"]);
    expect(fs.existsSync(path.join(homeRoot, ".codex", "skills", "claude-only"))).toBe(false);
  });

  it("reports a skill that has gone away instead of throwing", async () => {
    const result = await createService().setEnabled({ skillId: "skill_missing", enabled: true });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer available/i);
  });
});

describe("the manual update button", () => {
  it("re-reads a copied skill from the provider folder it came from", async () => {
    const service = createService();
    const origin = writeSkillFolder(path.join(homeRoot, ".claude", "skills", "helper"), {
      name: "helper",
      description: "The first description.",
      body: "First instructions.",
    });
    const external = service.list().skills[0];

    const copied = await service.copyToLibrary(external.id);
    expect(copied.success).toBe(true);
    const managed = copied.snapshot.skills.find((skill) => skill.id === copied.skillId);
    expect(managed).toMatchObject({ source: "managed", updateSource: "folder", originPath: origin });

    // Claude already holds the original, so bind the library copy elsewhere.
    const enabled = await service.setProviderEnabled({
      skillId: copied.skillId!,
      provider: "codex",
      enabled: true,
    });
    expect(enabled.success).toBe(true);

    writeSkillFolder(origin, {
      name: "helper",
      description: "The second description.",
      body: "Second instructions.",
    });

    const updated = await service.update(copied.skillId!);
    expect(updated.success).toBe(true);
    const refreshed = updated.snapshot.skills.find((skill) => skill.id === copied.skillId);
    expect(refreshed?.description).toBe("The second description.");
    expect(refreshed?.instructions).toBe("Second instructions.");
    // The refreshed copy is pushed out to every provider that had it enabled.
    expect(
      fs.readFileSync(path.join(homeRoot, ".codex", "skills", "helper", "SKILL.md"), "utf8"),
    ).toContain("Second instructions.");
  });

  it("restores a built-in skill to the version Cozea ships", async () => {
    const service = createService();
    const definition = BUILT_IN_SKILLS[0];
    const created = await service.save({
      name: definition.name,
      description: "Edited away from what Cozea ships.",
      instructions: "Edited instructions.",
      compatibleProviders: definition.compatibleProviders,
    });
    expect(created.snapshot.skills[0].updateSource).toBe("built-in");

    const updated = await service.update(created.skillId!);
    expect(updated.success).toBe(true);
    expect(updated.snapshot.skills[0].description).toBe(definition.description);
    expect(updated.snapshot.skills[0].instructions).toBe(definition.instructions);
  });

  it("refuses to update a skill that a provider owns", async () => {
    writeSkillFolder(path.join(homeRoot, ".claude", "skills", "theirs"), {
      name: "theirs",
      description: "Owned by the provider.",
      body: "Do the thing.",
    });
    const service = createService();
    const external = service.list().skills[0];

    const result = await service.update(external.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/provider folder/i);
  });

  it("says so when a skill has no origin left to update from", async () => {
    const service = createService();
    const created = await service.save({
      name: "Homegrown",
      description: "Written here, enabled nowhere.",
      instructions: "Do it.",
      compatibleProviders: ["claude"],
    });
    expect(created.snapshot.skills[0].updateSource).toBe("none");

    const result = await service.update(created.skillId!);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to update/i);
  });
});
