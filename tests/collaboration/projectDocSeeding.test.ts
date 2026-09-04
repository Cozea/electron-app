import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  seedProjectDocFromWorkspace,
  selectCollaborationSeedFiles,
} from "@/features/collaboration/runtime/seedProjectDocFromWorkspace"
import { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("collaboration base-tree seeding", () => {
  it("selects deterministic text files and excludes binary or oversized entries", () => {
    expect(
      selectCollaborationSeedFiles([
        { path: "src/z.ts", sizeBytes: 12 },
        { path: "public/logo.png", sizeBytes: 30 },
        { path: "src/a.ts", sizeBytes: 10 },
        { path: "src/a.ts", sizeBytes: 10 },
        { path: "huge.txt", sizeBytes: 2 * 1024 * 1024 + 1 },
        { path: "../escape.ts", sizeBytes: 5 },
      ]),
    ).toEqual([
      { path: "src/a.ts", sizeBytes: 10 },
      { path: "src/z.ts", sizeBytes: 12 },
    ])
  })

  it("hydrates an empty Yjs project from the local workspace exactly once", async () => {
    const listFiles = vi.fn(async () => ({
      success: true,
      files: [
        { path: "src/index.ts", sizeBytes: 21 },
        { path: "README.md", sizeBytes: 9 },
        { path: "public/logo.png", sizeBytes: 50 },
      ],
    }))
    const readFile = vi.fn(async ({ filePath }: { filePath: string }) => ({
      success: true,
      content: filePath === "README.md" ? "# Project" : "export const value = 1",
      sizeBytes: filePath === "README.md" ? 9 : 21,
    }))

    vi.stubGlobal("window", {
      electronAPI: {
        project: { listFiles, readFile },
      },
    })

    const doc = new YjsProjectDoc("project_1")
    const result = await seedProjectDocFromWorkspace({
      doc,
      workspaceId: "workspace_1",
    })

    expect(result).toEqual({
      seededFiles: 2,
      skippedFiles: 1,
      failedFiles: 0,
    })
    expect(doc.files.get("README.md")?.toString()).toBe("# Project")
    expect(doc.files.get("src/index.ts")?.toString()).toBe("export const value = 1")
    expect(doc.files.has("public/logo.png")).toBe(false)

    const second = await seedProjectDocFromWorkspace({
      doc,
      workspaceId: "workspace_1",
    })
    expect(second.seededFiles).toBe(0)
    expect(listFiles).toHaveBeenCalledTimes(1)

    doc.destroy()
  })

  it("binds persisted snapshots to the provider's acknowledged sequence", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/src/contexts/YjsProjectContext.tsx"),
      "utf8",
    )

    expect(source).toContain("wsProviderRef.current?.getKnownSeq()")
    expect(source).toContain("snapshotBaseSeq,")
    expect(source).toContain("seedProjectDocFromWorkspace")
  })
})
