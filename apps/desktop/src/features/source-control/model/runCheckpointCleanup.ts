import type { Id } from "../../../../../../convex/_generated/dataModel"

interface CheckpointCleanupPorts {
  deleteLocalRefs: (workspaceId: string) => Promise<unknown>
  clearSharedActivity: (projectId: Id<"projects">) => Promise<unknown>
}

/** Local commit cleanup never enrolls a project or depends on cloud availability. */
export async function runCheckpointCleanup(
  input: { workspaceId: string; cloudProjectId: Id<"projects"> | null; cloudActivityEnabled: boolean },
  ports: CheckpointCleanupPorts,
): Promise<void> {
  await ports.deleteLocalRefs(input.workspaceId)
  if (input.cloudActivityEnabled && input.cloudProjectId) {
    await ports.clearSharedActivity(input.cloudProjectId)
  }
}
