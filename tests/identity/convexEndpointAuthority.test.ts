import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const convexRoot = join(process.cwd(), "convex")
const ignored = new Set(["_generated", "lib"])

function sourceFiles(): string[] {
  return readdirSync(convexRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(convexRoot, entry.name))
}

describe("Convex endpoint authority boundary", () => {
  it("routes every public query and mutation through device auth or the gateway secret", () => {
    const failures: string[] = []
    for (const file of sourceFiles()) {
      if ([...ignored].some((part) => file.includes(`/${part}/`))) continue
      const source = readFileSync(file, "utf8")
      if (!/export const \w+\s*=\s*(?:query|mutation)\s*\(/.test(source)) continue
      const name = file.split("/").at(-1)
      const deviceAuthenticated = source.includes("./lib/authenticatedFunctions")
      const gatewayOnly = name === "deployments.ts" && source.includes("assertGatewaySecret")
      if (!deviceAuthenticated && !gatewayOnly) failures.push(name ?? file)
    }
    expect(failures).toEqual([])
  })

  it("keeps the historical destructive cleanup off the public API", () => {
    const source = readFileSync(join(convexRoot, "clean.ts"), "utf8")
    expect(source).toContain("internalMutation")
    expect(source).not.toMatch(/=\s*mutation\s*\(/)
  })

  it("marks every deployment endpoint as server-only and secret-protected", () => {
    const source = readFileSync(join(convexRoot, "deployments.ts"), "utf8")
    const names = [...source.matchAll(/export const (\w+)\s*=\s*(?:query|mutation)\s*\(/g)]
      .map((match) => match[1])
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((name) => name.endsWith("ForServer"))).toBe(true)
    expect((source.match(/serverSecret:\s*v\.string\(\)/g) ?? []).length).toBe(names.length)
  })
})
