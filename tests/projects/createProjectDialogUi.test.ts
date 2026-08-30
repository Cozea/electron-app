import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

function readWorkspaceSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8")
}

describe("create project dialog UI", () => {
  const dialogSource = readWorkspaceSource(
    "apps/desktop/src/features/projects/components/CreateProjectDialog.tsx",
  )

  it("renders the project setup dialog on an opaque readable surface", () => {
    const dialogContentSource = dialogSource.slice(
      dialogSource.indexOf("<DialogContent"),
      dialogSource.indexOf("<DialogHeader"),
    )

    expect(dialogContentSource).toContain("bg-popover")
    expect(dialogContentSource).toContain("shadow-xl")
    expect(dialogContentSource).not.toContain("bg-transparent")
    expect(dialogContentSource).not.toContain("shadow-none")
  })

  it("submits the chosen local project name with a folder-name fallback", () => {
    expect(dialogSource).toContain("resolveImportedProjectName(name, trimmedLocalFolderPath)")
    expect(dialogSource).toContain(
      "importPickedLocalFolder(trimmedLocalFolderPath, trimmedName)",
    )
  })

  it("routes picker and drop entry points through the naming dialog", () => {
    const entryPointSources = [
      "apps/desktop/src/pages/NewProject.tsx",
      "apps/desktop/src/features/projects/hooks/useProjectCreationMenu.ts",
      "apps/desktop/src/features/projects/pages/ProjectsLaunchPage.tsx",
    ].map(readWorkspaceSource)

    for (const source of entryPointSources) {
      expect(source).toContain('mode: "local"')
      expect(source).toContain("localFolderPath:")
      expect(source).not.toContain("importPickedLocalFolder(")
    }
  })
})
