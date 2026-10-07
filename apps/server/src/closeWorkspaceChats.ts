import * as Schema from "effect/Schema"
import { randomUUID } from "node:crypto"
import { OrchestrationShellSnapshot } from "@cozea/contracts/t3"
import type { OrchestrationRpcBackend } from "../../../apps/desktop/electron/substrate-shadow-server/rpcOrchestrationHandlers"

/** Exact catalog roots only. No project/thread deletion or provider interruption. */
export async function closeWorkspaceChats(backend: Pick<OrchestrationRpcBackend, "getSnapshot" | "dispatchCommand">, roots: readonly string[]): Promise<void> {
  const scope = new Set(roots)
  const read = async () => Schema.decodeUnknownSync(OrchestrationShellSnapshot)(await backend.getSnapshot())
  const snapshot = await read()
  const projects = new Set(snapshot.projects.filter((project) => scope.has(project.workspaceRoot)).map((project) => project.id))
  const matches = (thread: OrchestrationShellSnapshot["threads"][number]) => projects.has(thread.projectId) || thread.worktreePath !== null && scope.has(thread.worktreePath)
  const threads = snapshot.threads.filter(matches)
  if (threads.some((thread) => thread.latestTurn?.state === "running" || thread.session?.status === "starting" || thread.session?.status === "running" || thread.backgroundLiveness)) throw new Error("Stop running chats before closing this workspace. Conversations and drafts are retained.")
  for (const thread of threads) {
    if (thread.session && !["stopped", "error"].includes(thread.session.status)) await backend.dispatchCommand({
      type: "thread.session.stop", commandId: randomUUID(), threadId: thread.id, createdAt: new Date().toISOString(),
    })
  }
  const deadline = Date.now() + 10_000
  while (true) {
    const current = await read()
    // A newly bound project at the same root must also be checked.
    for (const project of current.projects) if (scope.has(project.workspaceRoot)) projects.add(project.id)
    if (!current.threads.some((thread) => matches(thread) && (thread.latestTurn?.state === "running" || thread.backgroundLiveness || thread.session && !["stopped", "error"].includes(thread.session.status)))) return
    if (Date.now() >= deadline) throw new Error("The chat runtime has not confirmed that this workspace's sessions stopped. Retry the saved close.")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
