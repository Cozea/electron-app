import { describe, expect, it } from "vitest"

import {
  resolveDevAppPreviewManifestPath,
  resolveDevAppPreviewRelativePath,
} from "@/features/devapps/model/devAppPreviewSelection"

describe("DevApp preview package selection", () => {
  it("stores a package below the project as a workspace-relative path", () => {
    expect(
      resolveDevAppPreviewRelativePath(
        "/Users/admin/project",
        "/Users/admin/project/apps/inventory",
      ),
    ).toBe("apps/inventory")
  })

  it("allows a package rooted at the workspace itself", () => {
    expect(resolveDevAppPreviewRelativePath("/Users/admin/project/", "/Users/admin/project")).toBe(
      ".",
    )
  })

  it("rejects a sibling with the same path prefix", () => {
    expect(
      resolveDevAppPreviewRelativePath("/Users/admin/project", "/Users/admin/project-other/app"),
    ).toBeNull()
  })

  it("normalizes Windows separators and drive-letter casing", () => {
    expect(
      resolveDevAppPreviewRelativePath("C:\\work\\project", "c:\\work\\project\\apps\\inventory\\"),
    ).toBe("apps/inventory")
  })

  it("derives the package folder from a selected manifest", () => {
    expect(
      resolveDevAppPreviewManifestPath(
        "/Users/admin/project",
        "/Users/admin/project/apps/inventory/cozea-devapp.json",
      ),
    ).toBe("apps/inventory")
  })

  it("rejects a different JSON file", () => {
    expect(
      resolveDevAppPreviewManifestPath(
        "/Users/admin/project",
        "/Users/admin/project/apps/inventory/package.json",
      ),
    ).toBeNull()
  })
})
