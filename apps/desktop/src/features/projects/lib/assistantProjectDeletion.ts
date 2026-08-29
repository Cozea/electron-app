import type { ProjectId } from "@cozea/assistant-contracts"

import { newCommandId } from "@/features/projects/components/assistant/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"
import { useStore } from "@/stores/assistant-store"

const STORAGE_KEY = "cozea:assistant-project-deletions:v1"
const DELETE_COMMAND_TIMEOUT_MS = 5_000

interface PendingAssistantProjectDeletions {
  version: 1
  projectIds: string[]
}

function readPendingState(): PendingAssistantProjectDeletions {
  if (typeof window === "undefined") {
    return { version: 1, projectIds: [] }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, projectIds: [] }
    const parsed = JSON.parse(raw) as Partial<PendingAssistantProjectDeletions>
    return {
      version: 1,
      projectIds: Array.from(
        new Set(
          (Array.isArray(parsed.projectIds) ? parsed.projectIds : [])
            .filter((projectId): projectId is string => typeof projectId === "string")
            .map((projectId) => projectId.trim())
            .filter(Boolean),
        ),
      ),
    }
  } catch {
    return { version: 1, projectIds: [] }
  }
}

function writePendingState(projectIds: Iterable<string>): void {
  if (typeof window === "undefined") return

  const normalizedProjectIds = Array.from(
    new Set(
      Array.from(projectIds)
        .map((projectId) => projectId.trim())
        .filter(Boolean),
    ),
  )
  try {
    if (normalizedProjectIds.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, projectIds: normalizedProjectIds }),
    )
  } catch {
    // A later deletion attempt or runtime sync can retry from live workbench state.
  }
}

export function queueAssistantProjectDeletions(projectIds: Iterable<string>): void {
  const pending = readPendingState()
  writePendingState([...pending.projectIds, ...projectIds])
}

export function collectAssistantProjectIdsForDeletion(input: {
  assistantProjectIds: Iterable<string>
  workspaceRoots: Iterable<string>
}): string[] {
  const assistantProjectIds = new Set(
    Array.from(input.assistantProjectIds)
      .map((projectId) => projectId.trim())
      .filter(Boolean),
  )
  const state = useStore.getState()
  for (const workspaceRoot of input.workspaceRoots) {
    const normalizedWorkspaceRoot = workspaceRoot.trim()
    if (!normalizedWorkspaceRoot) continue
    const assistantProjectId = state.projectIdByCwd[normalizedWorkspaceRoot]
    if (assistantProjectId) {
      assistantProjectIds.add(String(assistantProjectId))
    }
  }
  return Array.from(assistantProjectIds)
}

export async function flushPendingAssistantProjectDeletions(options: {
  snapshotIsAuthoritative?: boolean
} = {}): Promise<void> {
  const pending = readPendingState()
  if (pending.projectIds.length === 0) return

  const activeProjectIds = new Set(useStore.getState().projectIds.map(String))
  const projectIdsToDelete = options.snapshotIsAuthoritative
    ? pending.projectIds.filter((projectId) => activeProjectIds.has(projectId))
    : pending.projectIds
  const completedProjectIds = new Set(
    options.snapshotIsAuthoritative
      ? pending.projectIds.filter((projectId) => !activeProjectIds.has(projectId))
      : [],
  )

  const api = ensureNativeApi()
  const results = await Promise.allSettled(
    projectIdsToDelete.map(async (projectId) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          api.orchestration.dispatchCommand({
            type: "project.delete",
            commandId: newCommandId(),
            projectId: projectId as ProjectId,
            force: true,
          }),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Assistant project deletion timed out.")),
              DELETE_COMMAND_TIMEOUT_MS,
            )
          }),
        ])
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId)
      }
      return projectId
    }),
  )

  for (const result of results) {
    if (result.status === "fulfilled") {
      completedProjectIds.add(result.value)
    }
  }

  writePendingState(
    pending.projectIds.filter((projectId) => !completedProjectIds.has(projectId)),
  )
}

export async function deleteAssistantProjectsForDeletedWorkspace(input: {
  assistantProjectIds: Iterable<string>
  workspaceRoots: Iterable<string>
}): Promise<void> {
  const projectIds = collectAssistantProjectIdsForDeletion(input)
  if (projectIds.length === 0) return

  queueAssistantProjectDeletions(projectIds)
  try {
    await flushPendingAssistantProjectDeletions()
  } catch {
    // Runtime startup will retry after its next authoritative snapshot.
  }
}
