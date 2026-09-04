import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Agent Skills surface", () => {
  const pageSource = readWorkspaceSource(
    "apps/desktop/src/features/projects/pages/AgentSkillsPage.tsx",
  );

  it("is reachable as a first-class project-shell route and sidebar destination", () => {
    const routeSource = readWorkspaceSource("apps/desktop/src/router/routes.tsx");
    const projectSidebarSource = readWorkspaceSource(
      "apps/desktop/src/features/projects/ui/ProjectSidebar.tsx",
    );
    const layoutSource = readWorkspaceSource(
      "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx",
    );

    expect(routeSource).toContain('path: "/skills"');
    expect(projectSidebarSource).toContain('navigate("/projects/skills")');
    expect(layoutSource).toContain("LazyAgentSkillsSidebar");
  });

  it("keeps focused provider controls explicit and provider-complete", () => {
    expect(pageSource).toContain("Use with");
    expect(pageSource).toContain("All skills");
    expect(pageSource).toContain("View instructions");
    expect(pageSource).toContain("Codex");
    expect(pageSource).toContain("Claude");
    expect(pageSource).toContain("Cursor");
    expect(pageSource).toContain("OpenCode");
  });

  it("reports which providers run a skill without offering to switch it", () => {
    // Activation belongs to Builds: the library is for finding, installing,
    // updating and deleting. Leaving toggles here gave two places to change
    // the same state, and the library's copy went stale behind the other.
    expect(pageSource).not.toContain("setProviderEnabled");
    expect(pageSource).not.toContain("agentSkills.setEnabled");
    expect(pageSource).toContain("Turn skills on and off");
  });

  it("exposes portable read-only setup discovery and personal copying", () => {
    expect(pageSource).toContain("Read-only setup");
    expect(pageSource).toContain("openSetupPack");
    expect(pageSource).toContain("copyFromSetupPack");
    expect(pageSource).toContain("Copy to my library");
  });
});
