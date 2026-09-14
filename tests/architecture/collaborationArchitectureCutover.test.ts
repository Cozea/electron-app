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
    // P26 Cutover: The gate must NEVER contain the branch equality fallback.
    expect(gate).not.toContain("input.activeBranch === input.sharedBranch")
    expect(gate).toContain('return { enabled: false, reason: "private-branch" }')
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

  it("fails CI if renderer creates direct collaboration WebSocket connections", () => {
    const desktopSrc = path.join(repoRoot, "apps/desktop/src")
    if (!fs.existsSync(desktopSrc)) return

    const files = fs.readdirSync(desktopSrc, { recursive: true }) as string[]
    const violations: string[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue
      const fullPath = path.join(desktopSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      if (
        content.includes("/collab/ws") ||
        content.includes("CollabWsProvider") ||
        content.includes("useCollabSession") ||
        content.includes("YjsProjectContext")
      ) {
        violations.push(rel)
      }
    }

    expect(violations).toEqual([])
  })

  it("fails CI if deleted legacy collaboration and duplicate Git files are reintroduced", () => {
    const forbiddenFiles = [
      "apps/desktop/src/hooks/useAgentFileSync.ts",
      "apps/desktop/src/hooks/useBinaryFileSync.ts",
      "apps/desktop/src/hooks/useYjsFileWriteback.ts",
      "apps/desktop/src/hooks/useReconnectionSync.ts",
      "apps/desktop/src/lib/sync/SyncCoordinator.ts",
      "apps/desktop/src/contexts/YjsProjectContext.tsx",
      "apps/desktop/src/contexts/YjsProjectContextValue.tsx",
      "apps/desktop/src/components/editor/DeleteConflictDialog.tsx",
      "apps/desktop/src/features/collaboration/hooks/useCollabSession.ts",
      "apps/desktop/electron/projectWatcher.ts",
      "apps/desktop/electron/yjsNotify.ts",
      "apps/desktop/electron/ipc/registerYjsHandlers.ts",
      "apps/desktop/electron/services/projectGitDesktopService.ts",
      "apps/desktop/electron/services/gitSyncService.ts",
      "apps/desktop/electron/services/gitReplayWorkspaceState.ts",
      "apps/desktop/electron/services/syncJournalStore.ts",
      "apps/desktop/electron/substrate/vcs/collabPush.ts",
      "cloudflare/worker/src/durableObjects/CollabRoom.ts",
      "cloudflare/worker/src/routes/collabSession.ts",
      "convex/yjsAwareness.ts",
      "shared/yjsCore.ts",
    ]

    for (const file of forbiddenFiles) {
      const fullPath = path.join(repoRoot, file)
      expect(fs.existsSync(fullPath), `Expected ${file} to remain deleted`).toBe(false)
    }

    const yjsDir = path.join(repoRoot, "apps/desktop/src/lib/yjs")
    expect(fs.existsSync(yjsDir), "Expected apps/desktop/src/lib/yjs to remain deleted").toBe(false)
  })

  it("fails CI if obsolete Yjs tables are reintroduced into convex/schema.ts", () => {
    const schemaPath = path.join(repoRoot, "convex/schema.ts")
    const content = fs.readFileSync(schemaPath, "utf8")

    expect(content).not.toContain("yjsUpdates:")
    expect(content).not.toContain("yjsDocuments:")
    expect(content).not.toContain("yjsAwareness:")
  })

  it("fails CI if deleted CollabRoom Durable Object binding is reintroduced to wrangler.jsonc", () => {
    const wranglerPath = path.join(repoRoot, "cloudflare/worker/wrangler.jsonc")
    const content = fs.readFileSync(wranglerPath, "utf8")

    expect(content).not.toContain('"name": "COLLAB_ROOM"')
    expect(content).toContain('"deleted_classes": ["CollabRoom"]')
  })
})
