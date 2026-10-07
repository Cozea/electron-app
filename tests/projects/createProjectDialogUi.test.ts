import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

function readWorkspaceSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8")
}

describe("create project dialog UI", () => {
  const dialogSource = readWorkspaceSource(
    "apps/desktop/src/features/projects/ui/CreateProjectDialog.tsx",
  )

  it("renders the project setup dialog on an opaque readable surface", () => {
    // The dialog is a UnifiedModal, whose popup owns the surface.
    const modalSource = readWorkspaceSource("apps/desktop/src/components/ui/unified-modal.tsx")
    const popupSource = modalSource.slice(
      modalSource.indexOf("<BaseDialog.Popup"),
      modalSource.indexOf('data-slot="unified-modal-header"'),
    )

    expect(dialogSource).toContain("<UnifiedModal")
    expect(dialogSource).not.toContain("<DialogContent")
    expect(popupSource).toContain("bg-popover")
    expect(popupSource).not.toContain("bg-transparent")
    expect(popupSource).not.toContain("shadow-none")
  })

  it("keeps the tour's anchor on the dialog itself", () => {
    expect(dialogSource).toContain('tourTarget="create-project-dialog"')
  })

  it("submits the chosen local project name with a folder-name fallback", () => {
    expect(dialogSource).toContain("resolveImportedProjectName(name, trimmedLocalFolderPath)")
    expect(dialogSource).toContain(
      "importPickedLocalFolder(trimmedLocalFolderPath, trimmedName,",
    )
    expect(dialogSource).toContain('requireDevApp: mode === "devapp-local"')
  })

  it("routes picker and drop entry points through the naming dialog", () => {
    const entryPointSources = [
      "apps/desktop/src/pages/NewProject.tsx",
      "apps/desktop/src/features/projects/hooks/useProjectCreationMenu.ts",
      "apps/desktop/src/features/projects/pages/ProjectsLaunchPage.tsx",
    ].map(readWorkspaceSource)

    for (const source of entryPointSources) {
      expect(source).toContain("localFolderPath:")
      expect(source).not.toContain("importPickedLocalFolder(")
    }
    expect(entryPointSources[0]).toContain('nextMode === "local"')
    expect(entryPointSources[1]).toContain('selection === "local"')
    expect(entryPointSources[2]).toContain('mode: "local"')
  })
})
