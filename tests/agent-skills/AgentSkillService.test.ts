import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isReady: () => false, getPath: () => "/tmp/cozea-agent-skills-test" },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import { AgentSkillService } from "../../apps/desktop/electron/services/AgentSkillService";

let testRoot = "";
let dataRoot = "";
let homeRoot = "";

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-agent-skills-"));
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

describe("AgentSkillService", () => {
  it("creates a canonical skill and wires recoverable provider copies", async () => {
    const service = createService();
    const created = await service.save({
      name: "Review pull requests",
      description: "Review a change before it merges.",
      instructions: "Inspect the diff and report actionable findings.",
      compatibleProviders: ["codex", "claude", "cursor", "opencode"],
    });

    expect(created.success).toBe(true);
    expect(created.skillId).toMatch(/^skill_/);
    expect(created.snapshot.skills).toHaveLength(1);

    const enabled = await service.setProviderEnabled({
      skillId: created.skillId!,
      provider: "codex",
      enabled: true,
    });
    const codexPath = path.join(homeRoot, ".agents", "skills", "review-pull-requests");
    expect(enabled.success).toBe(true);
    expect(fs.existsSync(path.join(codexPath, "SKILL.md"))).toBe(true);
    expect(
      enabled.snapshot.skills[0].bindings.find((binding) => binding.provider === "codex"),
    ).toMatchObject({
      enabled: true,
      ownership: "managed",
    });

    const disabled = await service.setProviderEnabled({
      skillId: created.skillId!,
      provider: "codex",
      enabled: false,
    });
    expect(disabled.success).toBe(true);
    expect(fs.existsSync(codexPath)).toBe(false);
    expect(fs.readdirSync(path.join(dataRoot, "trash")).length).toBeGreaterThan(0);
  });

  it("discovers, disables, and restores a provider-owned skill without adopting it", async () => {
    const service = createService();
    const skillPath = path.join(homeRoot, ".claude", "skills", "release-check");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(
      path.join(skillPath, "SKILL.md"),
      "---\nname: release-check\ndescription: Check a release.\n---\n\nRun the release checklist.\n",
    );

    const discovered = service.list().skills[0];
    expect(discovered).toMatchObject({ source: "external", editable: false });
    expect(discovered.bindings.find((binding) => binding.provider === "claude")).toMatchObject({
      enabled: true,
      ownership: "external",
    });

    const disabled = await service.setProviderEnabled({
      skillId: discovered.id,
      provider: "claude",
      enabled: false,
    });
    expect(disabled.success).toBe(true);
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(
      disabled.snapshot.skills[0].bindings.find((binding) => binding.provider === "claude"),
    ).toMatchObject({
      enabled: false,
      ownership: "external",
    });

    const restored = await service.setProviderEnabled({
      skillId: discovered.id,
      provider: "claude",
      enabled: true,
    });
    expect(restored.success).toBe(true);
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("copies an external skill into an independently editable personal library entry", async () => {
    const service = createService();
    const skillPath = path.join(homeRoot, ".cursor", "skills", "ship-notes");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(
      path.join(skillPath, "SKILL.md"),
      "---\nname: ship-notes\ndescription: Prepare release notes.\n---\n\nSummarize user-facing changes.\n",
    );

    const external = service.list().skills[0];
    const copied = await service.copyToLibrary(external.id);

    expect(copied.success).toBe(true);
    expect(copied.snapshot.skills).toHaveLength(2);
    expect(copied.snapshot.skills.find((skill) => skill.id === copied.skillId)).toMatchObject({
      source: "managed",
      editable: true,
      originLabel: "Copied from a provider folder",
    });
  });
});
