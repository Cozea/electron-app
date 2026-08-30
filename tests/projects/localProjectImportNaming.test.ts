import { describe, expect, it } from "vitest"

import { resolveImportedProjectName } from "@/features/projects/lib/localProjectImport"

describe("local project import naming", () => {
  it("uses the project name entered after folder selection", () => {
    expect(resolveImportedProjectName("  Client workspace  ", "/Users/example/source-folder"))
      .toBe("Client workspace")
  })

  it("falls back to the selected folder name when the field is blank", () => {
    expect(resolveImportedProjectName("   ", "/Users/example/source-folder/"))
      .toBe("source-folder")
  })

  it("supports Windows-style paths and a safe final fallback", () => {
    expect(resolveImportedProjectName("", "C:\\work\\source-folder\\"))
      .toBe("source-folder")
    expect(resolveImportedProjectName("", ""))
      .toBe("Project")
  })
})
