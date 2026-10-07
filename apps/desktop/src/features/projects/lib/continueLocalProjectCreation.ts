import type { ElectronAPI } from "@cozea/app-contract/electronApi";
import type { LocalProjectsElectronAPI } from "@shared/localProjectTypes";
import type { LocalProjectCreationIntent } from "./localProjectCreationIntent";

interface CreationDependencies {
  projects: Pick<LocalProjectsElectronAPI, "create">;
  scaffold: ElectronAPI["devAppAuthoring"]["scaffold"];
  createGitHubRepo: ElectronAPI["project"]["createGitHubRepo"];
  saveIntent: (intent: LocalProjectCreationIntent) => Promise<void>;
  onIntentChanged?: (intent: LocalProjectCreationIntent) => void;
}

/** Renderer request receipts complement the main-owned folder operation journal. */
export async function continueLocalProjectCreation(
  initial: LocalProjectCreationIntent,
  deps: CreationDependencies,
) {
  let intent = initial;
  const save = async (next: LocalProjectCreationIntent) => {
    await deps.saveIntent(next);
    intent = next;
    deps.onIntentChanged?.(next);
  };
  // A reload or lost reply must recover this ID before allocating another folder.
  await save(intent);
  const result = await deps.projects.create(intent.request);
  if (!result.success) throw new Error(result.error);
  if (intent.postEffects !== "pending") {
    return {
      outcome: result.value,
      intent,
      needsReview: intent.postEffects === "running",
      needsAcknowledgement: false,
    };
  }
  const optionalEffects = intent.mode === "devapp" || intent.createGitHubRepo;
  if (optionalEffects) {
    // Interrupted optional effects require evidence inspection, never blind replay.
    await save({ ...intent, postEffects: "running" });
    if (intent.mode === "devapp") {
      const scaffold = await deps.scaffold({
        workspaceId: result.value.workspace.workspaceId,
        name: result.value.project.name,
        starter: intent.starter,
      });
      if (!scaffold.success) throw new Error(scaffold.error);
      await save({
        ...intent,
        devAppRef: scaffold.source.ref,
        warnings: scaffold.preparation?.warnings ?? [],
      });
    }
    if (intent.createGitHubRepo) {
      const gh = await deps.createGitHubRepo({
        workspaceId: result.value.workspace.workspaceId,
        name: intent.request.slug,
        visibility: intent.repoVisibility,
      });
      if (!gh.success) throw new Error(gh.error || "GitHub repository creation was not confirmed.");
    }
  }
  await save({ ...intent, postEffects: "finished" });
  return {
    outcome: result.value,
    intent,
    needsReview: false,
    needsAcknowledgement: Boolean(intent.warnings?.length),
  };
}
