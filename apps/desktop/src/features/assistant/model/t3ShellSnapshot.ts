import type { OrchestrationReadModel } from "@cozea/assistant-contracts";
import type { OrchestrationShellSnapshot } from "@cozea/contracts/t3";

/** Shell metadata never replaces transcript slices owned by thread detail streams. */
export function mergeT3ShellSnapshot(
  previous: OrchestrationReadModel,
  snapshot: OrchestrationShellSnapshot,
): OrchestrationReadModel {
  const threadsById = new Map(previous.threads.map((thread) => [String(thread.id), thread]));
  // Cozea's legacy read-model type still includes provider discriminants and
  // narrower runtime modes. Preserve native metadata verbatim at this existing
  // wire boundary; permission modes must never be reinterpreted by hydration.
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) => ({ ...project, deletedAt: null })),
    threads: snapshot.threads.map((thread) => {
      const cached = threadsById.get(thread.id);
      return {
        ...thread,
        deletedAt: null,
        messages: cached?.messages ?? [],
        activities: cached?.activities ?? [],
        proposedPlans: cached?.proposedPlans ?? [],
        checkpoints: cached?.checkpoints ?? [],
      };
    }),
  } as unknown as OrchestrationReadModel;
}
