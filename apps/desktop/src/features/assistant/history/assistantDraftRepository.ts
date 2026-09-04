import { create } from "zustand";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@cozea/assistant-contracts";
import type { PreviewAnnotationPayload } from "@cozea/contracts/t3/ipc";
import type { AssistantConversationContext } from "./assistantHistoryStore";

export interface PersistedDraftImage {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export interface AssistantContentDraft extends AssistantConversationContext {
  key: string;
  threadId: string | null;
  assistantProjectId: string | null;
  text: string;
  cursor: number;
  images: PersistedDraftImage[];
  annotations: PreviewAnnotationPayload[];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  revision: number;
  updatedAt: string;
}

export interface AssistantDraftStorage {
  list(): Promise<AssistantContentDraft[]>;
  write(puts: AssistantContentDraft[], deletes: string[]): Promise<void>;
}

export function createIndexedDbDraftStorage(): AssistantDraftStorage {
  let connection: Promise<IDBDatabase> | null = null;
  const open = () =>
    (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cozea-assistant-drafts", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "key" });
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          connection = null;
        };
        resolve(request.result);
      };
    }));
  return {
    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", "readonly");
        const request = tx.objectStore("drafts").getAll();
        tx.oncomplete = () => resolve(request.result as AssistantContentDraft[]);
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    },
    async write(puts, deletes) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        const store = tx.objectStore("drafts");
        for (const key of deletes) store.delete(key);
        for (const record of puts) store.put(record);
        // Request success is not durability: wait for the transaction commit.
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

interface DraftCache {
  drafts: Record<string, AssistantContentDraft>;
  ready: boolean;
  error: string | null;
}

export function hasDraftContent(draft: AssistantContentDraft): boolean {
  return Boolean(draft.text.trim() || draft.images.length || draft.annotations.length);
}

export function createAssistantDraftRepository(storage: AssistantDraftStorage) {
  const store = create<DraftCache>(() => ({ drafts: {}, ready: false, error: null }));
  let hydration: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  const adoptions = new Map<
    string,
    { key: string; threadId: string; assistantProjectId: string }
  >();
  const resolveKey = (key: string) => adoptions.get(key)?.key ?? key;
  const dirty = new Set<string>();
  const pendingDeletes = new Set<string>();
  const removed = new Set<string>();
  const failure = (error: unknown) =>
    store.setState({
      error: error instanceof Error ? error.message : "Could not save this draft on this device.",
    });
  const enqueue = (operation: () => Promise<void>) => {
    const task = queue.then(operation);
    queue = task.catch(failure);
    return task;
  };
  const load = () =>
    (hydration ??= storage
      .list()
      .then((records) => {
        store.setState((state) => ({
          drafts: {
            ...Object.fromEntries(records.map((record) => [record.key, record])),
            ...state.drafts,
          },
          ready: true,
          error: null,
        }));
      })
      .catch((error: unknown) => {
        hydration = null;
        failure(error);
        throw error;
      }));
  const save = (input: AssistantContentDraft) => {
    const adoption = adoptions.get(input.key);
    const record = adoption ? { ...input, ...adoption } : input;
    if (removed.has(record.key)) return;
    dirty.add(record.key);
    store.setState((state) => ({ drafts: { ...state.drafts, [record.key]: record } }));
    void enqueue(async () => {
      await storage.write([record], []);
      if (store.getState().drafts[record.key] === record) dirty.delete(record.key);
      if (!dirty.size) store.setState({ error: null });
    }).catch(() => {});
  };
  const flush = async () => {
    await load();
    await queue;
    if (dirty.size || pendingDeletes.size) {
      const records = [...dirty].flatMap((key) =>
        store.getState().drafts[key] ? [store.getState().drafts[key]] : [],
      );
      const deletes = [...pendingDeletes];
      await enqueue(async () => {
        await storage.write(records, deletes);
        for (const key of deletes) pendingDeletes.delete(key);
        for (const record of records)
          if (store.getState().drafts[record.key] === record) dirty.delete(record.key);
      });
    }
    if (dirty.size) return flush();
    store.setState({ error: null });
  };
  const remove = async (keys: string[]) => {
    await load();
    for (const key of keys) {
      removed.add(key);
      pendingDeletes.add(key);
    }
    store.setState((state) => {
      const drafts = { ...state.drafts };
      for (const key of keys) {
        delete drafts[key];
        dirty.delete(key);
      }
      return { drafts };
    });
    await flush();
  };
  return {
    store,
    load,
    save,
    flush,
    remove,
    resolveKey,
    async adopt(from: string, to: string, threadId: string, assistantProjectId: string) {
      const draft = store.getState().drafts[from];
      if (!draft || from === to) return;
      const adopted = { ...draft, key: to, threadId, assistantProjectId };
      adoptions.set(from, { key: to, threadId, assistantProjectId });
      dirty.delete(from);
      dirty.add(to);
      pendingDeletes.add(from);
      store.setState((state) => {
        const drafts = { ...state.drafts, [to]: adopted };
        delete drafts[from];
        return { drafts };
      });
      await flush();
    },
    async clearSubmitted(key: string, revision: number) {
      await queue;
      const draft = store.getState().drafts[key];
      if (!draft || draft.revision !== revision) return;
      // Retain context/preferences but not the acknowledged message.
      save({ ...draft, text: "", cursor: 0, images: [], annotations: [], revision: revision + 1 });
      await flush();
    },
    async removeProject(projectId: string) {
      await load();
      await remove(
        Object.values(store.getState().drafts)
          .filter((draft) => draft.projectId === projectId)
          .map((draft) => draft.key),
      );
    },
  };
}

export const assistantDrafts = createAssistantDraftRepository(createIndexedDbDraftStorage());
export const threadDraftKey = (threadId: string) => `thread:${threadId}`;
export const unboundDraftKey = (draftId: string) => `draft:${draftId}`;
