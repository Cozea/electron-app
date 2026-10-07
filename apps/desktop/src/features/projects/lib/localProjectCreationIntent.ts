import type { DevAppScaffoldStarter } from "@shared/devAppAuthoringTypes";
import type { CreateLocalProjectRequest } from "@shared/localProjectTypes";
import { isPlainRecord } from "@shared/desktopPersistenceTypes";
import {
  desktopPersistenceClient,
  type DesktopPersistenceClient,
} from "@/app/model/persistence/desktopPersistenceClient";

export interface LocalProjectCreationIntent {
  request: CreateLocalProjectRequest;
  mode: "empty" | "devapp";
  starter: DevAppScaffoldStarter;
  createGitHubRepo: boolean;
  repoVisibility: "public" | "private";
  /** Written before optional effects; an interrupted effect is never replayed. */
  postEffects: "pending" | "running" | "finished";
  devAppRef?: string | null;
  warnings?: string[];
}

const namespace = "projectCreationIntent";
const key = "active";

export function makeLocalProjectCreationIntentRepository(persistence: DesktopPersistenceClient) {
  async function read(): Promise<LocalProjectCreationIntent | null> {
    await persistence.hydrateNamespace(namespace, [key]);
    const intent = persistence.peek<unknown>(namespace, key);
    if (intent === undefined) return null;
    if (
      !isPlainRecord(intent) ||
      !isPlainRecord(intent.request) ||
      typeof intent.request.operationId !== "string" ||
      intent.request.operationId.length > 120 ||
      typeof intent.request.name !== "string" ||
      intent.request.name.length > 120 ||
      typeof intent.request.slug !== "string" ||
      intent.request.slug.length > 120 ||
      typeof intent.request.parentFolder !== "string" ||
      intent.request.parentFolder.length > 4096 ||
      !["empty", "devapp"].includes(String(intent.mode)) ||
      !["view", "worker", "view-worker"].includes(String(intent.starter)) ||
      typeof intent.createGitHubRepo !== "boolean" ||
      !["public", "private"].includes(String(intent.repoVisibility)) ||
      !["pending", "running", "finished"].includes(String(intent.postEffects)) ||
      (intent.devAppRef !== undefined &&
        intent.devAppRef !== null &&
        (typeof intent.devAppRef !== "string" || intent.devAppRef.length > 1024)) ||
      (intent.warnings !== undefined &&
        (!Array.isArray(intent.warnings) ||
          intent.warnings.length > 128 ||
          intent.warnings.some(
            (warning: unknown) => typeof warning !== "string" || warning.length > 4096,
          )))
    ) {
      throw new Error(
        "The saved project creation request needs recovery before another project can be created.",
      );
    }
    return intent as unknown as LocalProjectCreationIntent;
  }

  async function save(intent: LocalProjectCreationIntent): Promise<void> {
    persistence.queueDirtyRecord(namespace, key, intent);
    await persistence.flush();
  }

  async function acknowledge(
    intent?: LocalProjectCreationIntent,
    projectId?: string,
  ): Promise<void> {
    if (intent?.postEffects === "running") {
      await persistence.hydrateNamespace(namespace);
      const archivedKey = `unconfirmed:${intent.request.operationId}`;
      const archived = persistence
        .entries(namespace)
        .filter((entry) => entry.key.startsWith("unconfirmed:"));
      if (archived.length >= 128 && !archived.some((entry) => entry.key === archivedKey)) {
        throw new Error(
          "Project setup recovery needs attention before another request can be started.",
        );
      }
      persistence.queueDirtyRecord(namespace, archivedKey, { intent, projectId });
      await persistence.flush();
    }
    persistence.deleteRecord(namespace, key);
    await persistence.flush();
  }

  return { read, save, acknowledge };
}

const repository = makeLocalProjectCreationIntentRepository(desktopPersistenceClient);
export const readLocalProjectCreationIntent = repository.read;
export const saveLocalProjectCreationIntent = repository.save;
export const clearLocalProjectCreationIntent = repository.acknowledge;
