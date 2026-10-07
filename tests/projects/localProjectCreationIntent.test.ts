import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopPersistenceClient,
  type DesktopPersistenceAPI,
} from "@/app/model/persistence/desktopPersistenceClient";
import {
  makeLocalProjectCreationIntentRepository,
  type LocalProjectCreationIntent,
} from "@/features/projects/lib/localProjectCreationIntent";
import { continueLocalProjectCreation } from "@/features/projects/lib/continueLocalProjectCreation";
import { DesktopStatePersistenceWorkerCore } from "../../apps/desktop/electron/workers/desktopStatePersistenceWorkerCore";
import type { ElectronAPI } from "../../shared/electronApiTypes";
import type { CreateLocalProjectRequest } from "../../shared/localProjectTypes";
import { localOutcome } from "./localProjectFixtures";

let directory: string;
let core: DesktopStatePersistenceWorkerCore;
let api: DesktopPersistenceAPI;
function repository() {
  return makeLocalProjectCreationIntentRepository(
    new DesktopPersistenceClient(
      () => api,
      async () => {},
    ),
  );
}
const intent: LocalProjectCreationIntent = {
  request: {
    operationId: "create_one",
    name: "Personal",
    slug: "personal",
    parentFolder: "/tmp/projects",
  },
  mode: "empty",
  starter: "view-worker",
  createGitHubRepo: false,
  repoVisibility: "private",
  postEffects: "pending",
};
function dependencies(saveIntent: (intent: LocalProjectCreationIntent) => Promise<void>) {
  return {
    projects: {
      create: vi.fn(async (_request: CreateLocalProjectRequest) => ({
        success: true as const,
        value: localOutcome,
      })),
    },
    scaffold: vi.fn<ElectronAPI["devAppAuthoring"]["scaffold"]>(),
    createGitHubRepo: vi.fn<ElectronAPI["project"]["createGitHubRepo"]>(),
    saveIntent,
  };
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-create-receipt-"));
  core = new DesktopStatePersistenceWorkerCore({ userDataPath: directory });
  api = {
    load: (options) => core.load(options.namespace, options.keys),
    // Same monotonic assignment as the separately-tested main persistence writer.
    commit: vi.fn(async ({ records }) => {
      const assigned = [];
      for (const record of records) {
        const previous = await core.load(record.namespace, [record.key]);
        assigned.push({
          ...record,
          recordRevision: (previous.records[0]?.recordRevision ?? 0) + 1,
        });
      }
      return core.commit(assigned);
    }),
    flush: (options) => core.flush(options?.targetRevision),
  };
});
afterEach(async () => {
  await core.flush();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("durable local creation requests", () => {
  it("recovers the same request after a lost reply and renderer restart", async () => {
    const first = repository();
    const deps = dependencies(first.save);
    deps.projects.create.mockRejectedValueOnce(new Error("reply lost"));
    await expect(continueLocalProjectCreation(intent, deps)).rejects.toThrow("reply lost");
    core = new DesktopStatePersistenceWorkerCore({ userDataPath: directory });
    const restarted = repository();
    const restored = (await restarted.read())!;
    expect(restored.request.operationId).toBe("create_one");
    const resumed = await continueLocalProjectCreation(restored, {
      ...deps,
      saveIntent: restarted.save,
    });
    expect(resumed.outcome.project.cloudProjectId).toBeNull();
    expect(deps.projects.create.mock.calls.map(([request]) => request.operationId)).toEqual([
      "create_one",
      "create_one",
    ]);
    expect(deps.scaffold).not.toHaveBeenCalled();
    expect(deps.createGitHubRepo).not.toHaveBeenCalled();
    await restarted.acknowledge(resumed.intent, resumed.outcome.project.projectId);
    expect(await repository().read()).toBeNull();
  });

  it("blocks filesystem effects when its request cannot be durably saved", async () => {
    vi.mocked(api.commit).mockResolvedValueOnce({
      status: "error",
      committedRevisions: {},
      errorMessage: "disk full",
    });
    const repo = repository();
    const deps = dependencies(repo.save);
    await expect(continueLocalProjectCreation(intent, deps)).rejects.toThrow("disk full");
    expect(deps.projects.create).not.toHaveBeenCalled();
    await repo.save(intent);
  });

  it("preserves unconfirmed GitHub work without replaying it or allocating a new request", async () => {
    const first = repository();
    const deps = dependencies(first.save);
    deps.createGitHubRepo.mockRejectedValueOnce(new Error("GitHub reply lost"));
    await expect(
      continueLocalProjectCreation({ ...intent, createGitHubRepo: true }, deps),
    ).rejects.toThrow("GitHub reply lost");
    const restarted = repository();
    const restored = (await restarted.read())!;
    expect(restored.postEffects).toBe("running");
    const resumed = await continueLocalProjectCreation(restored, {
      ...deps,
      saveIntent: restarted.save,
    });
    expect(resumed.needsReview).toBe(true);
    expect(deps.createGitHubRepo).toHaveBeenCalledOnce();
    await restarted.acknowledge(resumed.intent, resumed.outcome.project.projectId);
    expect(await repository().read()).toBeNull();
    expect(
      (await core.load("projectCreationIntent")).records.filter((record) => !record.deleted),
    ).toMatchObject([
      {
        key: "unconfirmed:create_one",
        data: { projectId: localOutcome.project.projectId, intent: { postEffects: "running" } },
      },
    ]);
  });

  it("refuses a corrupt saved request instead of silently allocating a replacement", async () => {
    await core.commit([
      {
        namespace: "projectCreationIntent",
        key: "active",
        schemaVersion: 1,
        recordRevision: 1,
        updatedAt: 1,
        data: false,
      },
    ]);
    await expect(repository().read()).rejects.toThrow("needs recovery");
  });
});
