import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * W06 prequalification: two participants' layouts must differ without affecting
 * sync. Layout state lives in the renderer; the executable guarantee here is
 * directional — the synchronization plane cannot see layout modules, so no
 * layout payload can reach a peer through it. Visual divergence itself is a
 * P27 physical-matrix row.
 */
describe("W06 session layout isolation", () => {
  const repoRoot = process.cwd()

  function sourceFiles(root: string): string[] {
    const out: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".ts")) out.push(full)
      }
    }
    walk(root)
    return out
  }

  it("keeps layout modules out of the synchronization plane", () => {
    const syncRoots = [
      path.join(repoRoot, "apps/projectd/src"),
      path.join(repoRoot, "shared/collaboration"),
    ]
    const violations: string[] = []
    for (const root of syncRoots) {
      if (!fs.existsSync(root)) continue
      for (const file of sourceFiles(root)) {
        const content = fs.readFileSync(file, "utf8")
        if (/from\s+["'][^"']*dockview[^"']*["']/i.test(content) || /require\(["'][^"']*dockview/i.test(content)) {
          violations.push(path.relative(repoRoot, file))
        }
        if (/workbenchTileContract/i.test(content)) {
          violations.push(path.relative(repoRoot, file))
        }
      }
    }
    expect(violations).toEqual([])
  })

  it("rejects layout keys on the serialized cloud session descriptor", async () => {
    const { serializeSessionDescriptor, SerializationError } = await import(
      "../../shared/collaboration/serialization"
    )
    const base = {
      publicSessionId: "czs_0123456789abcdef",
      projectId: "proj_layout",
      branchName: "feature/live",
      lifecycle: "ACTIVE",
    }
    for (const key of ["layout", "dockview", "dockviewLayout", "panels", "tiles", "presentation", "workbenchLayout"]) {
      expect(() => serializeSessionDescriptor({ ...base, [key]: { panes: [] } } as never)).toThrow(SerializationError)
    }
  })
})
