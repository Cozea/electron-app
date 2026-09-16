import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Two contract universes exist and, for now, both stay.
 *
 * `packages/contracts/src/t3` is vendored from t3code -- 41 files carrying a
 * `@generated from vendor/t3code` banner, written by
 * `scripts/vendor/sync-t3-contracts.mjs`. `shared/assistant-contracts` is
 * hand-maintained, has no provenance, and re-exports many of the same names
 * with different shapes: `GitStackedAction` is five values upstream and three
 * here, `GitCommitStepStatus` three against two.
 *
 * Merging them was considered and deliberately deferred: ~194 importers sit on
 * one side and ~124 on the other, the schema differences are real, and nothing
 * currently crosses between them. See `docs/git-subsystem-fragmentation.md`.
 *
 * So this file does not forbid the duplication. It freezes it, because the
 * arrangement is latent rather than harmless: both universes publish a barrel,
 * several files import both, and a single careless `import { X }` would resolve
 * to whichever barrel is listed first while typechecking perfectly.
 */
describe("contract universe boundary", () => {
  const repoRoot = process.cwd()
  const SHARED = "shared/assistant-contracts"
  const VENDORED = "packages/contracts/src/t3"

  /**
   * Names exported by both universes today, per file. A ratchet: these may
   * fall, never rise. Adding a name that already exists on the other side
   * widens a collision nobody is watching.
   */
  const OVERLAP_BASELINE: Readonly<Record<string, number>> = {
    "baseSchemas.ts": 18,
    "editor.ts": 2,
    "git.ts": 12,
    "ipc.ts": 8,
    "keybindings.ts": 12,
    "model.ts": 13,
    "orchestration.ts": 84,
    "project.ts": 5,
    "provider.ts": 9,
    "providerInstance.ts": 10,
    "providerRuntime.ts": 118,
    "server.ts": 14,
    "settings.ts": 18,
    "terminal.ts": 12,
  }

  /**
   * Files importing both barrel roots. Each is one careless import away from
   * taking a name from the wrong universe, so the set is pinned: a new one is
   * a deliberate edit here, not an accident.
   *
   * Scanned across `apps`, `packages` and `shared` -- the roots where this was
   * measured.
   */
  const DUAL_BARREL_IMPORTERS: readonly string[] = [
    "apps/desktop/src/substrate/createT3NativeApi.ts",
    "apps/server/src/t3/orchestrationProxy.ts",
    "packages/client-runtime/src/orchestrationClient.ts",
    "packages/client-runtime/src/t3/t3OrchestrationClient.ts",
    "packages/client-runtime/src/t3/t3ServerConfigClient.ts",
    "packages/client-runtime/src/t3/t3TerminalClient.ts",
    "packages/client-runtime/src/t3/t3VcsClient.ts",
  ]

  const EXPORT_PATTERN =
    /export\s+(?:declare\s+)?(?:const|type|interface|class|function)\s+([A-Za-z0-9_]+)/g

  function exportedNames(absolutePath: string): Set<string> {
    const found = new Set<string>()
    const content = fs.readFileSync(absolutePath, "utf8")
    let match: RegExpExecArray | null
    EXPORT_PATTERN.lastIndex = 0
    while ((match = EXPORT_PATTERN.exec(content))) found.add(match[1]!)
    return found
  }

  function overlapByFile(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const name of fs.readdirSync(path.join(repoRoot, SHARED))) {
      if (!name.endsWith(".ts")) continue
      const vendored = path.join(repoRoot, VENDORED, name)
      if (!fs.existsSync(vendored)) continue

      const mine = exportedNames(path.join(repoRoot, SHARED, name))
      const theirs = exportedNames(vendored)
      const both = [...mine].filter((each) => theirs.has(each)).sort()
      if (both.length) result[name] = both
    }
    return result
  }

  function listSources(root: string): string[] {
    const directory = path.join(repoRoot, root)
    if (!fs.existsSync(directory)) return []
    return (fs.readdirSync(directory, { recursive: true }) as string[])
      .filter((rel) => rel.endsWith(".ts") || rel.endsWith(".tsx"))
      .map((rel) => path.join(directory, rel))
      .filter((full) => {
        try {
          return fs.statSync(full).isFile()
        } catch {
          return false
        }
      })
  }

  it("does not widen the set of names both universes export", () => {
    const actual = overlapByFile()
    const grown = Object.entries(actual)
      .filter(([file, names]) => names.length > (OVERLAP_BASELINE[file] ?? 0))
      .map(([file, names]) => `${file}: ${names.length} > ${OVERLAP_BASELINE[file] ?? 0}`)

    expect(
      grown,
      "A name now exists in both contract universes that did not before. Put it in " +
        "one of them, or lower the other side -- do not raise this baseline.",
    ).toEqual([])
  })

  it("keeps the total overlap from growing", () => {
    const total = Object.values(overlapByFile()).reduce((sum, names) => sum + names.length, 0)
    const baseline = Object.values(OVERLAP_BASELINE).reduce((sum, count) => sum + count, 0)

    expect(total).toBeLessThanOrEqual(baseline)
  })

  /**
   * The names a file imports from one barrel, read from its import clause.
   *
   * Reading the clause rather than the file body is the whole point. A file may
   * legitimately import both barrels and mention a name they both export, so
   * long as it takes that name from one of them — which is exactly what all
   * seven dual-barrel importers do, taking types from assistant-contracts and
   * only method-name constants from the vendored set. An earlier version of
   * this test grepped the body and reported all seven as violations for doing
   * nothing wrong.
   */
  function importedNames(content: string, specifier: string): Set<string> {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(
      `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`,
      "g",
    )
    const found = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content))) {
      for (const raw of match[1]!.split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim()
        if (name) found.add(name)
      }
    }
    return found
  }

  it("lets no file take the same name from both universes", () => {
    // The duplication is tolerable only while nothing crosses it. The moment one
    // file imports the same name from both, the two schemas meet in one place
    // and a value valid under one is rejected by the other.
    const offenders: string[] = []

    for (const root of ["apps", "packages", "shared"]) {
      for (const fullPath of listSources(root)) {
        const rel = path.relative(repoRoot, fullPath).split(path.sep).join("/")
        if (rel.startsWith(SHARED) || rel.startsWith(VENDORED)) continue
        if (rel.includes("/node_modules/") || rel.includes("/vendor/")) continue

        const content = fs.readFileSync(fullPath, "utf8")
        const fromShared = importedNames(content, "@cozea/assistant-contracts")
        if (fromShared.size === 0) continue
        const fromVendored = importedNames(content, "@cozea/contracts")
        if (fromVendored.size === 0) continue

        for (const name of fromShared) {
          if (fromVendored.has(name)) offenders.push(`${rel} imports ${name} from both`)
        }
      }
    }

    expect(
      offenders,
      "A file imports the same name from both contract universes. Those two names are " +
        "different schemas — pick one universe for it.",
    ).toEqual([])
  })

  it("keeps the set of files importing both barrels pinned", () => {
    const found: string[] = []

    for (const root of ["apps", "packages", "shared"]) {
      for (const fullPath of listSources(root)) {
        const rel = path.relative(repoRoot, fullPath).split(path.sep).join("/")
        if (rel.includes("/node_modules/") || rel.includes("/vendor/")) continue

        const content = fs.readFileSync(fullPath, "utf8")
        if (
          content.includes('from "@cozea/assistant-contracts"') &&
          content.includes('from "@cozea/contracts"')
        ) {
          found.push(rel)
        }
      }
    }

    expect(
      found.sort(),
      "A new file imports both contract barrels. That is one careless import away from " +
        "taking a name from the wrong universe -- add it here deliberately, or import " +
        "from a single universe.",
    ).toEqual([...DUAL_BARREL_IMPORTERS].sort())
  })
})
