import { type ProjectId } from "@cozea/assistant-contracts";

export {
  CHECKPOINT_REFS_PREFIX,
  LEGACY_T3_CHECKPOINT_REFS_PREFIX,
  checkpointRefForGroupId,
  checkpointRefForThreadTurn,
  isLegacyT3CheckpointRef,
  migrateLegacyT3CheckpointRefs,
  normalizeCheckpointRef,
} from "../../substrate/vcs/checkpointRefs";

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}
