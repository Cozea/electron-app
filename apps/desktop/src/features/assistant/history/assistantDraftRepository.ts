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

interface PersistedDraftImageReference {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blobKey: string;
}

interface PersistedDraftImageBlob extends PersistedDraftImageReference {
  key: string;
  draftKey: string;
  blob: Blob;
}

type PersistedDraftMetadata = Omit<AssistantContentDraft, "images"> & {
  images: PersistedDraftImageReference[];
};

const DRAFT_DATABASE_NAME = "cozea-assistant-drafts";
const DRAFT_DATABASE_VERSION = 2;
const DRAFT_STORE = "drafts";
const DRAFT_ATTACHMENT_STORE = "attachments";
const DRAFT_ATTACHMENT_DRAFT_INDEX = "draftKey";

function attachmentBlobKey(draftKey: string, imageId: string): string {
  return JSON.stringify([draftKey, imageId]);
}

function attachmentSignature(image: Pick<PersistedDraftImage, "id" | "name" | "mimeType" | "sizeBytes">): string {
  return JSON.stringify([image.id, image.name, image.mimeType, image.sizeBytes]);
}

function draftMetadata(record: AssistantContentDraft): PersistedDraftMetadata {
  return {
    ...record,
    images: record.images.map((image) => ({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      blobKey: attachmentBlobKey(record.key, image.id),
    })),
  };
}

export function createIndexedDbDraftStorage(): AssistantDraftStorage {
  let connection: Promise<IDBDatabase> | null = null;
  const knownAttachmentSignatures = new Map<string, string>();
  const open = () =>
    (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DRAFT_DATABASE_NAME, DRAFT_DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;
        const drafts = db.objectStoreNames.contains(DRAFT_STORE)
          ? transaction?.objectStore(DRAFT_STORE)
          : db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
        const attachments = db.objectStoreNames.contains(DRAFT_ATTACHMENT_STORE)
          ? transaction?.objectStore(DRAFT_ATTACHMENT_STORE)
          : db.createObjectStore(DRAFT_ATTACHMENT_STORE, { keyPath: "key" });
        if (attachments && !attachments.indexNames.contains(DRAFT_ATTACHMENT_DRAFT_INDEX)) {
          attachments.createIndex(DRAFT_ATTACHMENT_DRAFT_INDEX, "draftKey", { unique: false });
        }
        // v1 stored Blobs inline. Move them inside the same upgrade transaction
        // and replace the draft row only after every attachment put is queued.
        if (event.oldVersion < 2 && drafts && attachments) {
          const cursorRequest = drafts.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const legacy = cursor.value as AssistantContentDraft;
            if (Array.isArray(legacy.images)) {
              const metadata = draftMetadata(legacy);
              for (const image of legacy.images) {
                const blobKey = attachmentBlobKey(legacy.key, image.id);
                attachments.put({
                  ...image,
                  key: blobKey,
                  blobKey,
                  draftKey: legacy.key,
                } satisfies PersistedDraftImageBlob);
              }
              cursor.update(metadata);
            }
            cursor.continue();
          };
        }
      };
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
        const tx = db.transaction([DRAFT_STORE, DRAFT_ATTACHMENT_STORE], "readonly");
        const draftsRequest = tx.objectStore(DRAFT_STORE).getAll();
        const attachmentsRequest = tx.objectStore(DRAFT_ATTACHMENT_STORE).getAll();
        tx.oncomplete = () => {
          const attachments = attachmentsRequest.result as PersistedDraftImageBlob[];
          const blobsByKey = new Map(attachments.map((image) => [image.key, image]));
          knownAttachmentSignatures.clear();
          for (const image of attachments) {
            knownAttachmentSignatures.set(image.key, attachmentSignature(image));
          }
          resolve(
            (draftsRequest.result as PersistedDraftMetadata[]).map((draft) => ({
              ...draft,
              images: draft.images.flatMap((reference) => {
                const stored = blobsByKey.get(reference.blobKey);
                return stored
                  ? [{
                      id: reference.id,
                      name: reference.name,
                      mimeType: reference.mimeType,
                      sizeBytes: reference.sizeBytes,
                      blob: stored.blob,
                    }]
                  : [];
              }),
            })),
          );
        };
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    },
    async write(puts, deletes) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DRAFT_STORE, DRAFT_ATTACHMENT_STORE], "readwrite");
        const store = tx.objectStore(DRAFT_STORE);
        const attachmentStore = tx.objectStore(DRAFT_ATTACHMENT_STORE);
        const attachmentIndex = attachmentStore.index(DRAFT_ATTACHMENT_DRAFT_INDEX);
        const signatureUpdates = new Map<string, string | null>();
        const deleteAttachments = (draftKey: string, keep: ReadonlySet<string>) => {
          const request = attachmentIndex.openKeyCursor(IDBKeyRange.only(draftKey));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const key = String(cursor.primaryKey);
            if (!keep.has(key)) {
              attachmentStore.delete(cursor.primaryKey);
              signatureUpdates.set(key, null);
            }
            cursor.continue();
          };
        };
        for (const key of deletes) {
          store.delete(key);
          deleteAttachments(key, new Set());
        }
        for (const record of puts) {
          const metadata = draftMetadata(record);
          store.put(metadata);
          const keep = new Set(metadata.images.map((image) => image.blobKey));
          deleteAttachments(record.key, keep);
          for (const image of record.images) {
            const key = attachmentBlobKey(record.key, image.id);
            const signature = attachmentSignature(image);
            if (knownAttachmentSignatures.get(key) === signature) continue;
            attachmentStore.put({
              ...image,
              key,
              blobKey: key,
              draftKey: record.key,
            } satisfies PersistedDraftImageBlob);
            signatureUpdates.set(key, signature);
          }
        }
        // Request success is not durability: wait for the transaction commit.
        tx.oncomplete = () => {
          for (const [key, signature] of signatureUpdates) {
            if (signature === null) knownAttachmentSignatures.delete(key);
            else knownAttachmentSignatures.set(key, signature);
          }
          resolve();
        };
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
  let persistence: Promise<void> | null = null;
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
  const persistDirty = async () => {
    const records = [...dirty].flatMap((key) =>
      store.getState().drafts[key] ? [store.getState().drafts[key]] : [],
    );
    const deletes = [...pendingDeletes];
    if (records.length === 0 && deletes.length === 0) return;

    await storage.write(records, deletes);
    for (const key of deletes) pendingDeletes.delete(key);
    for (const record of records) {
      if (store.getState().drafts[record.key] === record) dirty.delete(record.key);
    }
    if (!dirty.size && !pendingDeletes.size) store.setState({ error: null });
  };
  const ensurePersistence = (): Promise<void> => {
    if (persistence) return persistence;
    const attempt = (async () => {
      await Promise.resolve();
      while (dirty.size || pendingDeletes.size) await persistDirty();
    })();
    persistence = attempt;
    void attempt.then(
      () => {
        if (persistence === attempt) persistence = null;
      },
      (error) => {
        if (persistence === attempt) persistence = null;
        failure(error);
      },
    );
    return attempt;
  };
  const save = (input: AssistantContentDraft) => {
    const adoption = adoptions.get(input.key);
    const record = adoption ? { ...input, ...adoption } : input;
    if (removed.has(record.key)) return;
    dirty.add(record.key);
    store.setState((state) => ({ drafts: { ...state.drafts, [record.key]: record } }));
    void ensurePersistence().catch(() => {});
  };
  const flush = async () => {
    await load();
    while (dirty.size || pendingDeletes.size || persistence) await ensurePersistence();
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
      if (persistence) await persistence;
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
