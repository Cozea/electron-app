import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import * as Schema from "effect/Schema"
import { ClientOrchestrationCommand, OrchestrationShellSnapshot } from "@cozea/contracts/t3"

/** Reads durable main-owned exclusions; missing/corrupt authority fails closed. */
export function readExcludedWorkspaceRoots(catalogPath: string): string[] {
  const db = new DatabaseSync(catalogPath, { readOnly: true })
  try {
    const rows = db.prepare("SELECT scope_json, state FROM project_exclusions").all()
    const active = new Set(db.prepare(`SELECT w.project_root_path AS root FROM local_workspaces w
      JOIN local_projects p ON p.project_id = w.project_id WHERE p.status = 'active'
      AND w.verification_status = 'verified' AND NOT EXISTS(SELECT 1 FROM project_exclusions e WHERE e.project_id = w.project_id)
      UNION SELECT l.project_root_path AS root FROM workspace_lanes l JOIN local_projects p ON p.project_id = l.project_id
      WHERE p.status = 'active' AND NOT EXISTS(SELECT 1 FROM project_exclusions e WHERE e.project_id = l.project_id)`).all().map((row) => String(row.root)))
    return rows.flatMap((row) => {
      const scope: unknown = JSON.parse(String(row.scope_json))
      if (!Array.isArray(scope)) throw new Error("Invalid saved workspace exclusion")
      return scope.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object" || !Array.isArray((entry as { roots?: unknown }).roots)) throw new Error("Invalid saved workspace exclusion roots")
        const roots = (entry as { roots: unknown[] }).roots
        if (roots.some((root) => typeof root !== "string" || !path.isAbsolute(root))) throw new Error("Invalid saved workspace exclusion root")
        return (roots as string[]).filter((root) => row.state !== "removed" || !active.has(root))
      })
    })
  } finally { db.close() }
}

export async function assertWorkspaceCommandAllowed(command: unknown, excludedRoots: readonly string[], getSnapshot: () => Promise<unknown>): Promise<void> {
  const decoded = Schema.decodeUnknownSync(ClientOrchestrationCommand)(command)
  await assertWorkspaceRequestAllowed("orchestration.dispatchCommand", decoded, excludedRoots, getSnapshot)
}

/** Native T3 terminals and Git share the same exclusion as orchestration. */
export async function assertWorkspaceRequestAllowed(method: string, payload: unknown, excludedRoots: readonly string[], getSnapshot: () => Promise<unknown>): Promise<void> {
  if (!method.startsWith("terminal.") && !method.startsWith("vcs.") && !method.startsWith("git.") && method !== "orchestration.dispatchCommand") return
  if (!excludedRoots.length) return
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid workspace request")
  const blocked = (root: string | null | undefined) => Boolean(root && excludedRoots.some((excluded) => path.resolve(root) === path.resolve(excluded) || path.resolve(root).startsWith(`${path.resolve(excluded)}${path.sep}`)))
  const snapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot)(await getSnapshot())
  const input = payload as Record<string, unknown>
  const thread = typeof input.threadId === "string" ? snapshot.threads.find((item) => item.id === input.threadId) : null
  const projectId = thread?.projectId ?? input.projectId
  const project = snapshot.projects.find((item) => item.id === projectId)
  if (blocked(project?.workspaceRoot) || blocked(thread?.worktreePath) || ["workspaceRoot", "worktreePath", "cwd", "path"].some((key) => blocked(typeof input[key] === "string" ? input[key] : null))) {
    throw new Error("This workspace is excluded by its saved local removal. Recover or cancel that removal before running chat commands.")
  }
}
