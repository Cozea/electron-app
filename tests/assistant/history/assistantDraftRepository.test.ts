import { describe, expect, it } from "vitest";
import { ProviderInstanceId } from "@cozea/assistant-contracts";
import {
  createAssistantDraftRepository,
  hasDraftContent,
  type AssistantContentDraft,
  type AssistantDraftStorage,
} from "@/features/assistant/history/assistantDraftRepository";

function record(patch: Partial<AssistantContentDraft> = {}): AssistantContentDraft {
  return {
    key: "draft:a",
    projectId: "project-a",
    workspaceId: "workspace-a",
    laneId: "lane-a",
    rootPath: "/project-a",
    branch: "main",
    threadId: null,
    assistantProjectId: "runtime-a",
    text: "Unsent text",
    cursor: 5,
    images: [],
    annotations: [],
    modelSelection: {
      provider: "codex",
      instanceId: ProviderInstanceId.make("codex"),
      model: "test-model",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    revision: 1,
    updatedAt: "2026-09-04T20:00:00Z",
    ...patch,
  };
}

function memoryStorage() {
  const rows = new Map<string, AssistantContentDraft>();
  let fail = false;
  const storage: AssistantDraftStorage = {
    list: async () => [...rows.values()].map((row) => structuredClone(row)),
    write: async (puts, deletes) => {
      if (fail) throw new Error("Storage quota exceeded");
      for (const key of deletes) rows.delete(key);
      for (const row of puts) rows.set(row.key, structuredClone(row));
    },
  };
  return {
    rows,
    storage,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe("durable assistant drafts", () => {
  it("restores text, cursor, preferences and image bytes in a fresh repository", async () => {
    const { storage } = memoryStorage();
    const first = createAssistantDraftRepository(storage);
    await first.load();
    first.save(
      record({
        images: [
          {
            id: "image",
            name: "test.png",
            mimeType: "image/png",
            sizeBytes: 3,
            blob: new Blob(["png"], { type: "image/png" }),
          },
        ],
      }),
    );
    await first.flush();
    const second = createAssistantDraftRepository(storage);
    await second.load();
    const restored = second.store.getState().drafts["draft:a"]!;
    expect(restored.text).toBe("Unsent text");
    expect(restored.cursor).toBe(5);
    expect(restored.modelSelection.model).toBe("test-model");
    expect(await restored.images[0]!.blob.text()).toBe("png");
    expect(restored.images[0]).not.toHaveProperty("previewUrl");
  });

  it("adopts a draft into one conversation without retaining a phantom draft", async () => {
    const { storage, rows } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    await repo.adopt("draft:a", "thread:t", "t", "runtime-a");
    expect(rows.has("draft:a")).toBe(false);
    expect(rows.get("thread:t")?.threadId).toBe("t");
    expect(repo.store.getState().drafts["thread:t"]?.text).toBe("Unsent text");
  });

  it("redirects edits from a still-mounted draft controller after adoption", async () => {
    const { storage, rows } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    await repo.adopt("draft:a", "thread:t", "t", "runtime-a");
    repo.save(record({ text: "Newer typing", revision: 2 }));
    await repo.flush();
    expect(rows.has("draft:a")).toBe(false);
    expect(rows.get("thread:t")?.text).toBe("Newer typing");
  });

  it("clears acknowledged content but retains preferences", async () => {
    const { storage } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    await repo.clearSubmitted("draft:a", 1);
    expect(hasDraftContent(repo.store.getState().drafts["draft:a"]!)).toBe(false);
    expect(repo.store.getState().drafts["draft:a"]?.modelSelection.model).toBe("test-model");
  });

  it("retries a failed adoption without losing newer typing or resurrecting the old identity", async () => {
    const backend = memoryStorage();
    const repo = createAssistantDraftRepository(backend.storage);
    await repo.load();
    repo.save(record());
    await repo.flush();
    backend.fail(true);
    await expect(repo.adopt("draft:a", "thread:t", "t", "runtime-a")).rejects.toThrow("quota");
    repo.save(record({ text: "Typed after binding", revision: 2 }));
    backend.fail(false);
    await repo.flush();
    expect(backend.rows.has("draft:a")).toBe(false);
    expect(backend.rows.get("thread:t")?.text).toBe("Typed after binding");
  });

  it("does not resurrect deleted content from a delayed controller callback", async () => {
    const backend = memoryStorage();
    const repo = createAssistantDraftRepository(backend.storage);
    await repo.load();
    repo.save(record());
    await repo.remove(["draft:a"]);
    repo.save(record({ revision: 2 }));
    await repo.flush();
    expect(backend.rows.size).toBe(0);
  });

  it("does not clear newer typing when an earlier send is acknowledged", async () => {
    const { storage } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    repo.save(record({ text: "Keep this", revision: 2 }));
    await repo.clearSubmitted("draft:a", 1);
    expect(repo.store.getState().drafts["draft:a"]?.text).toBe("Keep this");
  });

  it("retains failed or uncertain submissions until explicitly acknowledged", async () => {
    const { storage } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    await repo.flush();
    const restored = createAssistantDraftRepository(storage);
    await restored.load();
    expect(restored.store.getState().drafts["draft:a"]?.text).toBe("Unsent text");
  });

  it("blocks a flush on storage failure without losing in-memory content, and retries", async () => {
    const backend = memoryStorage();
    const repo = createAssistantDraftRepository(backend.storage);
    await repo.load();
    backend.fail(true);
    repo.save(record());
    await expect(repo.flush()).rejects.toThrow("Storage quota");
    expect(repo.store.getState().drafts["draft:a"]?.text).toBe("Unsent text");
    backend.fail(false);
    await repo.flush();
    expect(repo.store.getState().error).toBeNull();
    expect(backend.rows.has("draft:a")).toBe(true);
  });

  it("cleans only the deleted project's drafts, including closed tiles and blobs", async () => {
    const { storage, rows } = memoryStorage();
    const repo = createAssistantDraftRepository(storage);
    await repo.load();
    repo.save(record());
    repo.save(record({ key: "draft:b", projectId: "project-b" }));
    await repo.removeProject("project-a");
    expect([...rows.keys()]).toEqual(["draft:b"]);
    expect(Object.keys(repo.store.getState().drafts)).toEqual(["draft:b"]);
  });

  it("does not overwrite newer in-memory edits with slow hydration", async () => {
    const backend = memoryStorage();
    let finish!: (records: AssistantContentDraft[]) => void;
    backend.storage.list = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const repo = createAssistantDraftRepository(backend.storage);
    const loading = repo.load();
    repo.save(record({ text: "new", revision: 2 }));
    finish([record({ text: "old" })]);
    await loading;
    await repo.flush();
    expect(repo.store.getState().drafts["draft:a"]?.text).toBe("new");
  });
});
