import type { SessionWorkspaceBinding } from "../../../../shared/collaborationDesktop"

const READ_ONLY_OPERATIONS = new Set(["read-file", "list-files", "git-read", "import-read"])

export function assertCollaborationWorkspaceOperation(rawPolicy: string | null, operation: string): void {
  if (!rawPolicy) return
  const binding = JSON.parse(rawPolicy) as SessionWorkspaceBinding
  if (READ_ONLY_OPERATIONS.has(operation)) return
  if (binding.generation !== 3 || binding.state !== "active" || binding.role !== "editor") {
    throw new Error(binding.role === "observer"
      ? "Observers cannot edit files or start terminals, agents, previews, or other write-capable actions in a shared workspace"
      : "This session workspace is retained for recovery; resume the session before starting write-capable actions")
  }
}
