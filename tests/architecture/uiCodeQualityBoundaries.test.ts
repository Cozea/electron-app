import { existsSync, readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8")

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(relative)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [relative] : []
  })
}

describe("UI code quality boundaries", () => {
  it("keeps generic primitives independent from feature UI", () => {
    for (const file of sourceFiles("apps/desktop/src/components/ui")) {
      expect(read(file), file).not.toMatch(/["']@\/features\//)
    }
  })

  it("does not restore the retired assistant primitive layer", () => {
    const retiredRoot = resolve(ROOT, "apps/desktop/src/features/assistant/ui")
    const retiredFiles = existsSync(retiredRoot)
      ? sourceFiles("apps/desktop/src/features/assistant/ui")
      : []
    expect(retiredFiles).toEqual([])

    for (const file of sourceFiles("apps/desktop/src")) {
      expect(read(file), file).not.toContain("features/assistant/ui/")
    }
  })

  it("keeps Skills presentation out of page modules and breaks the former page cycle", () => {
    const agentSkillsPage = read(
      "apps/desktop/src/features/projects/pages/AgentSkillsPage.tsx",
    )
    const skillBuildsView = read(
      "apps/desktop/src/features/projects/components/SkillBuildsView.tsx",
    )
    expect(agentSkillsPage).toContain("features/projects/components/SkillBuildsView")
    expect(skillBuildsView).not.toContain("features/projects/pages/AgentSkillsPage")
    expect(skillBuildsView).toContain("features/projects/model/agentSkillPresentation")
  })

  it("uses one leaf loader definition for routes and prewarming", () => {
    const routes = read("apps/desktop/src/router/routes.tsx")
    const destinations = read("apps/desktop/src/app/navigation/destinations.ts")
    const directOverlappingLoader =
      /import\(["']@\/(?:features\/(?:projects\/pages\/(?:ProjectsLaunchPage|ProjectWorkbenchPage|AgentSkillsPage)|devapps\/pages\/AppStorePage|inbox\/pages\/InboxPage|tasks\/pages\/TasksPage)|pages\/NewProject)/

    expect(routes).toContain("destinationModules")
    expect(destinations).toContain("destinationModules")
    expect(routes).not.toMatch(directOverlappingLoader)
    expect(destinations).not.toMatch(directOverlappingLoader)
  })

  it("does not restore obsolete assistant controller hooks or translation casts", () => {
    for (const name of [
      "useAssistantApprovals.ts",
      "useAssistantTileBinding.ts",
      "useAssistantTurnSend.ts",
    ]) {
      expect(
        existsSync(
          resolve(ROOT, "apps/desktop/src/features/workbench/assistant", name),
        ),
      ).toBe(false)
    }

    for (const file of [
      "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
      "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    ]) {
      expect(read(file), file).not.toContain("t as any")
    }
  })

  it("keeps the Settings sidebar free of the removed account profile footer", () => {
    const settingsSidebar = read(
      "apps/desktop/src/features/settings/ui/SettingsSidebar.tsx",
    )
    expect(settingsSidebar).not.toContain("NavUser")
    expect(settingsSidebar).not.toContain("account profile")
  })

  it("tracks the complete app URL for the Settings back action", () => {
    const projectLayout = read(
      "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx",
    )

    expect(projectLayout).toContain(
      "useLocation({ select: (location) => location.href })",
    )
    expect(projectLayout).toContain("saveLastAppRoute(currentHref)")
  })
})
