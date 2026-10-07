import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe("stale local project binding recovery", () => {
  const projectsSource = readFileSync(resolve(process.cwd(), "convex/projects.ts"), "utf8")
  const importHookSource = readFileSync(
    resolve(
      process.cwd(),
      "apps/desktop/src/features/projects/hooks/useLocalProjectImport.ts",
    ),
    "utf8",
  )
  const projectLayoutSource = readFileSync(
    resolve(
      process.cwd(),
      "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx",
    ),
    "utf8",
  )
  const createProjectDialogSource = readFileSync(
    resolve(
      process.cwd(),
      "apps/desktop/src/features/projects/ui/CreateProjectDialog.tsx",
    ),
    "utf8",
  )

  it("keeps the access probe authenticated while returning null for an inaccessible project", () => {
    const lookupSource = projectsSource.slice(
      projectsSource.indexOf("export const getAccessibleById"),
      projectsSource.indexOf("export const getAccessibleBySlug"),
    )

    expect(lookupSource).toContain("baseQuery({")
    expect(lookupSource).toContain("requireAuthenticatedDevice(ctx)")
    expect(lookupSource).toContain("canAccessProject(ctx, args.projectId, device._id)")
    expect(lookupSource).toContain("return null")
    expect(lookupSource).not.toContain("userId: v.id")
  })

  it("uses the local lifecycle and preserves bindings regardless of cloud access", () => {
    expect(importHookSource).toContain("requireLocalProjectsApi().open({")
    expect(importHookSource).toContain("result.value.project.projectId")
    expect(importHookSource).not.toContain("api.projects")
    expect(importHookSource).not.toContain("cleanupDeletedProjectLocally")
    expect(importHookSource).not.toContain('as Id<"projects">')
  })

  it("does not expose an unverified last-workbench project to header collaboration queries", () => {
    const collaborationIdSource = projectLayoutSource.slice(
      projectLayoutSource.indexOf("const collaborationProjectId"),
      projectLayoutSource.indexOf("const chromeHeader"),
    )

    expect(collaborationIdSource).toContain("return cloudProjectId")
    expect(collaborationIdSource).not.toContain("readLastWorkbenchRoute")
  })

  it("opens the initial chat through idempotent navigation state instead of a replayable URL effect", () => {
    for (const source of [importHookSource, createProjectDialogSource]) {
      expect(source).toContain("buildWorkbenchIntentState({")
      expect(source).toContain('ensureTile: "assistantChat"')
      // The URL names only the workbench; the chat to open travels in state.
      expect(source).toContain('{ to: "workbench", projectId }')
      expect(source).not.toContain('{ to: "workbench", projectId, laneId: DEFAULT_WORKBENCH_LANE_ID }')
      expect(source).not.toContain("laneId: DEFAULT_WORKBENCH_LANE_ID, openTile")
    }
  })
})
