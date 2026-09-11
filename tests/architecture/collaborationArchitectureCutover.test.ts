import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * P26 Architecture Cutover Guardrails.
 *
 * Master Specification: Section 26
 * Fail CI if:
 * - projectd imports React;
 * - projectd imports Electron renderer code;
 * - collaboration correctness path depends on Workbench tile type;
 * - new direct Git execution appears outside GitService;
 * - activeBranch === collabBranch decides membership;
 * - source-editor tile is added as collaboration requirement.
 */
describe("P26 collaboration architecture cutover guardrails", () => {
  const repoRoot = process.cwd()

  it("fails CI if projectd imports React", () => {
    const projectdSrc = path.join(repoRoot, "apps/projectd/src")
    if (!fs.existsSync(projectdSrc)) return

    const files = fs.readdirSync(projectdSrc, { recursive: true }) as string[]
    const violations: string[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      const fullPath = path.join(projectdSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      if (
        content.includes('from "react"') ||
        content.includes("from 'react'") ||
        content.includes('import "react"') ||
        content.includes("import 'react'")
      ) {
        violations.push(rel)
      }
    }

    expect(violations).toEqual([])
  })

  it("fails CI if projectd imports Electron renderer code", () => {
    const projectdSrc = path.join(repoRoot, "apps/projectd/src")
    if (!fs.existsSync(projectdSrc)) return

    const files = fs.readdirSync(projectdSrc, { recursive: true }) as string[]
    const violations: string[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      const fullPath = path.join(projectdSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      if (
        content.includes('from "@/"') ||
        content.includes("from '@/'") ||
        content.includes("apps/desktop/src") ||
        content.includes('from "electron"') ||
        content.includes("from 'electron'")
      ) {
        violations.push(rel)
      }
    }

    expect(violations).toEqual([])
  })

  it("fails CI if branch equality decides collaboration ahead of a session record", () => {
    const layout = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx"),
      "utf8",
    )
    const gate = fs.readFileSync(
      path.join(repoRoot, "apps/desktop/src/features/collaboration/collaborationGate.ts"),
      "utf8",
    )

    // ProjectLayout delegates the decision and never compares branches itself.
    expect(layout).toContain("resolveCollaborationGate(")
    expect(layout).not.toMatch(/activeBranch\s*===\s*collabBranch/)
    // The gate consults the branch's session record before the shared-branch
    // fallback, so a session always outranks branch equality.
    const sessionCheck = gate.indexOf("if (session)")
    expect(sessionCheck).toBeGreaterThan(-1)
    expect(sessionCheck).toBeLessThan(gate.indexOf("input.activeBranch === input.sharedBranch"))
  })

  it("fails CI if source-editor tile is added as collaboration requirement", () => {
    const contractPath = path.join(
      repoRoot,
      "apps/desktop/src/lib/workbenchTileContract.ts",
    )
    const content = fs.readFileSync(contractPath, "utf8")

    const forbidden = ["editor", "codeEditor", "fileEditor", "sourceEditor", "monaco"]
    for (const f of forbidden) {
      expect(content).not.toMatch(new RegExp(`["']${f}["']`))
    }
  })
})
