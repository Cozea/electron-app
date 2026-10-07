import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import * as Schema from "effect/Schema"
import { OrchestrationShellSnapshot } from "@cozea/contracts/t3"
import type { OrchestrationRpcBackend } from "../../../apps/desktop/electron/substrate-shadow-server/rpcOrchestrationHandlers"
import { closeWorkspaceChats } from "./closeWorkspaceChats.ts"

interface RemovalEvidence {
  version: 1
  operationId: string
  roots: string[]
  projects: Array<{ id: string; root: string }>
  threads: Array<{ id: string; projectId: string; worktreePath: string | null }>
}
function isRemovalEvidence(value: unknown): value is RemovalEvidence {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<RemovalEvidence>
  const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 512
  const root = (value: unknown) => typeof value === "string" && value.length <= 4096 && path.isAbsolute(value)
  return row.version === 1 && id(row.operationId) && Array.isArray(row.roots) && row.roots.length <= 64 && row.roots.every(root) &&
    Array.isArray(row.projects) && row.projects.length <= 128 && row.projects.every((project) => project && id(project.id) && root(project.root)) &&
    new Set(row.projects.map((project) => project.id)).size === row.projects.length &&
    Array.isArray(row.threads) && row.threads.length <= 2048 && row.threads.every((thread) => thread && id(thread.id) && id(thread.projectId) && (thread.worktreePath === null || root(thread.worktreePath))) &&
    new Set(row.threads.map((thread) => thread.id)).size === row.threads.length
}
/** Durable native ID scope precedes deletion; retry never re-discovers new history. */
export async function removeWorkspaceChats(backend: Pick<OrchestrationRpcBackend, "getSnapshot" | "dispatchCommand">,
  roots: readonly string[], operationId: string, receiptDirectory: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId) || !roots.length || roots.length > 64 || roots.some((root) => !path.isAbsolute(root) || root.length > 4096)) throw new Error("Invalid native removal scope")
  const read = async () => Schema.decodeUnknownSync(OrchestrationShellSnapshot)(await backend.getSnapshot())
  await closeWorkspaceChats(backend, roots)
  const filename = path.join(receiptDirectory, `${operationId}.json`)
  await fs.mkdir(receiptDirectory, { recursive: true })
  let evidence: RemovalEvidence
  try { evidence = JSON.parse(await fs.readFile(filename, "utf8")) as RemovalEvidence }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The saved native data-removal scope needs inspection.")
    const current = await read()
    const projects = current.projects.filter((project) => roots.includes(project.workspaceRoot))
    const ids = new Set(projects.map((project) => project.id))
    const threads = current.threads.filter((thread) => ids.has(thread.projectId) || thread.worktreePath !== null && roots.includes(thread.worktreePath))
    if (threads.length > 2048 || projects.length > 128) throw new Error("The native data scope is too large for this removal.")
    evidence = { version: 1, operationId, roots: [...roots].sort(), projects: projects.map((project) => ({ id: project.id, root: project.workspaceRoot })),
      threads: threads.map((thread) => ({ id: thread.id, projectId: thread.projectId, worktreePath: thread.worktreePath })) }
    const file = await fs.open(filename, "wx", 0o600)
    try { await file.writeFile(JSON.stringify(evidence)); await file.sync() } finally { await file.close() }
    const directory = await fs.open(receiptDirectory, "r")
    try { await directory.sync() } finally { await directory.close() }
  }
  if (!isRemovalEvidence(evidence) || evidence.operationId !== operationId || JSON.stringify(evidence.roots) !== JSON.stringify([...roots].sort())) throw new Error("This saved native removal belongs to another scope.")
  for (const saved of evidence.threads) {
    const current = await read()
    const thread = current.threads.find((item) => item.id === saved.id)
    if (!thread) continue
    if (thread.projectId !== saved.projectId || thread.worktreePath !== saved.worktreePath || thread.latestTurn?.state === "running" || thread.backgroundLiveness || thread.session && !["stopped", "error"].includes(thread.session.status)) throw new Error("The saved chat context changed. No new history was removed.")
    await backend.dispatchCommand({ type: "thread.delete", commandId: randomUUID(), threadId: thread.id })
  }
  const threadDeadline = Date.now() + 10_000
  while ((await read()).threads.some((thread) => evidence.threads.some((saved) => saved.id === thread.id))) {
    if (Date.now() >= threadDeadline) throw new Error("Native thread deletion has not reached its authoritative snapshot. Retry the saved request.")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  for (const saved of evidence.projects) {
    const current = await read()
    const project = current.projects.find((item) => item.id === saved.id)
    if (!project) continue
    if (project.workspaceRoot !== saved.root || current.threads.some((thread) => thread.projectId === project.id)) throw new Error("This native project retains new or unconfirmed chats. Inspect its saved removal.")
    await backend.dispatchCommand({ type: "project.delete", commandId: randomUUID(), projectId: project.id })
  }
  const deadline = Date.now() + 10_000
  while (true) {
    const current = await read()
    if (!current.threads.some((thread) => evidence.threads.some((saved) => saved.id === thread.id)) && !current.projects.some((project) => evidence.projects.some((saved) => saved.id === project.id))) return
    if (Date.now() >= deadline) throw new Error("Native history deletion has not reached its authoritative snapshot. Retry the saved request.")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
