import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

function directProjectOwnedTables(schemaSource: string): string[] {
  const tableHeaders = Array.from(
    schemaSource.matchAll(/^  ([A-Za-z0-9_]+): defineTable\(\{/gm),
  )
  const projectTables: string[] = []

  for (const [index, match] of tableHeaders.entries()) {
    const start = match.index ?? 0
    const end = tableHeaders[index + 1]?.index ?? schemaSource.length
    if (schemaSource.slice(start, end).includes('projectId: v.id("projects")')) {
      projectTables.push(match[1]!)
    }
  }

  return projectTables
}

describe("project deletion completeness", () => {
  const schemaSource = [
    "convex/schema/base.ts",
    "convex/schema/collaboration.ts",
    "convex/schema/collaborationRepositories.ts",
  ]
    .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
    .join("\n")
  const projectsSource = readFileSync(resolve(process.cwd(), "convex/projects.ts"), "utf8")

  it("purges every table whose rows are directly owned by a project", () => {
    const projectTables = directProjectOwnedTables(schemaSource)

    expect(projectTables.length).toBeGreaterThan(20)
    for (const tableName of projectTables) {
      expect(projectsSource, `missing purge query for ${tableName}`).toContain(
        `.query("${tableName}")`,
      )
    }
  })

  it("deletes stored project blobs and schedules the purge after soft deletion", () => {
    expect(projectsSource).toContain("ctx.storage.delete(row.artifactStorageId)")
    expect(projectsSource).toContain("ctx.storage.delete(row.storageId)")
    expect(projectsSource).toContain("ctx.storage.delete(project.previewImageId)")
    expect(projectsSource).toContain("internal.projects.purgeDeletedProjectData")
    expect(projectsSource).toContain("await ctx.db.delete(args.projectId)")
    expect(projectsSource).toContain("export const resumeDeletedProjectPurge")
  })
})
