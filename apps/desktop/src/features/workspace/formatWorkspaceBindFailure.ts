interface WorkspaceBindFailureLike {
  error?: string
  conflicts?: Array<{
    reason: string
    existingProjectId?: string | null
    candidatePath?: string
  }>
}

/**
 * Bind failures carry structured conflicts with no `error` string; surfacing
 * them raw left actions failing with "undefined". One formatter for every
 * bind call site (import, relink, repair).
 */
export function formatWorkspaceBindFailure(
  result: WorkspaceBindFailureLike | null | undefined,
  fallback = "Failed to bind the local folder.",
): string {
  if (result?.error) {
    return result.error
  }

  const conflict = result?.conflicts?.[0]
  if (!conflict) {
    return fallback
  }

  switch (conflict.reason) {
    case "duplicate_path":
      return conflict.existingProjectId
        ? "This folder is already linked to another project. Open that project instead, or choose a different folder."
        : "This folder is already linked to another workspace."
    case "marker_mismatch":
      return "This folder belongs to a different Cozea project (its workspace marker points elsewhere). Choose a different folder, or remove the .cozea marker if this is intentional."
    case "copied_workspace":
      return "This looks like a copy of an already-linked folder (the original still exists). Open the original project, or remove the .cozea marker from this copy to link it as a separate project."
    default:
      return fallback
  }
}
