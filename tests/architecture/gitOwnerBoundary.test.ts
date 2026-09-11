import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Architecture boundary test (P05):
 * Ensures all Git operations in apps/projectd route through GitService / GitProcess.
 * Direct invocation of git CLI outside allowed git implementation files is forbidden.
 */
describe("Git owner consolidation boundary", () => {
  const repoRoot = process.cwd()

  it("forbids raw git process execution in projectd outside apps/projectd/src/git", () => {
    const projectdSrc = path.join(repoRoot, "apps/projectd/src")
    if (!fs.existsSync(projectdSrc)) return

    const files = fs.readdirSync(projectdSrc, { recursive: true }) as string[]
    const violations: string[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      if (rel.startsWith("git/") || rel.startsWith("git\\")) continue // Allowed git layer

      const fullPath = path.join(projectdSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      // Look for direct child_process spawns of "git"
      if (
        (content.includes('spawn("git"') ||
          content.includes("spawn('git'") ||
          content.includes('execFile("git"') ||
          content.includes("execFile('git'") ||
          content.includes('execSync("git') ||
          content.includes("execSync('git")) &&
        !content.includes("GitProcess")
      ) {
        violations.push(rel)
      }
    }

    expect(violations).toEqual([])
  })
})
