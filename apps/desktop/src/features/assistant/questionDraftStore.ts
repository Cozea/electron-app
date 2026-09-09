import { create } from "zustand";

import { pendingUserInputDraftFromAnswer, resolvePendingUserInputAnswer } from "@/features/assistant/pendingUserInput";
import type { PendingUserInput } from "@/features/assistant/chat/session-logic";

export interface QuestionSubmission {
  commandId: string;
  createdAt: string;
  answers: Record<string, string | string[]>;
}

export interface QuestionDraft {
  answers: Record<string, string | string[]>;
  submission?: QuestionSubmission;
}

export interface QuestionDraftStorage {
  list(): Promise<Record<string, QuestionDraft>>;
  updateAnswer(key: string, questionId: string, answer: string | string[]): Promise<QuestionDraft>;
  prepare(key: string, submission: QuestionSubmission): Promise<QuestionSubmission>;
  remove(key: string): Promise<void>;
  importLegacy(records: Record<string, QuestionDraft>): Promise<void>;
}

interface QuestionDraftState {
  drafts: Record<string, QuestionDraft>;
  ready: boolean;
  error: string | null;
  setAnswer: (key: string, questionId: string, answer: string | string[]) => Promise<void>;
  prepare: (key: string, submission: QuestionSubmission) => Promise<QuestionSubmission>;
  remove: (key: string) => Promise<void>;
}

const LEGACY_STORAGE_PREFIX = "cozea:question-draft:v1:";
const DATABASE_NAME = "cozea-question-drafts";
const DATABASE_STORE = "drafts";

export function questionDraftKey(
  threadId: string,
  request: Pick<PendingUserInput, "requestId" | "createdAt">,
): string {
  return JSON.stringify([threadId, request.requestId, request.createdAt]);
}

function decodeDraft(raw: string | null): QuestionDraft | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("answers" in value)) return undefined;
    const answers = value.answers;
    if (
      !answers ||
      typeof answers !== "object" ||
      Array.isArray(answers) ||
      !Object.values(answers).every(
        (answer) =>
          typeof answer === "string" ||
          (Array.isArray(answer) && answer.every((entry) => typeof entry === "string")),
      )
    ) {
      return undefined;
    }
    if ("submission" in value) {
      const submission = value.submission;
      if (
        !submission ||
        typeof submission !== "object" ||
        !("commandId" in submission) ||
        typeof submission.commandId !== "string" ||
        !("createdAt" in submission) ||
        typeof submission.createdAt !== "string" ||
        !("answers" in submission) ||
        JSON.stringify(submission.answers) !== JSON.stringify(answers)
      ) {
        return undefined;
      }
    }
    return value as QuestionDraft;
  } catch {
    return undefined;
  }
}

function readLegacyDrafts(): Record<string, QuestionDraft> {
  const drafts: Record<string, QuestionDraft> = {};
  if (typeof localStorage === "undefined") return drafts;
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(LEGACY_STORAGE_PREFIX)) continue;
    const draft = decodeDraft(localStorage.getItem(storageKey));
    if (draft) drafts[storageKey.slice(LEGACY_STORAGE_PREFIX.length)] = draft;
  }
  return drafts;
}

function clearImportedLegacyDrafts(keys: ReadonlyArray<string>): void {
  if (typeof localStorage === "undefined") return;
  for (const key of keys) localStorage.removeItem(LEGACY_STORAGE_PREFIX + key);
}

export function createIndexedDbQuestionDraftStorage(): QuestionDraftStorage {
  let connection: Promise<IDBDatabase> | null = null;
  const open = () =>
    (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
          request.result.createObjectStore(DATABASE_STORE);
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

  const mutate = async <T>(
    key: string,
    update: (current: QuestionDraft | undefined) => { value: T; draft?: QuestionDraft },
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DATABASE_STORE, "readwrite");
      const store = transaction.objectStore(DATABASE_STORE);
      const request = store.get(key);
      let result: T;
      request.onsuccess = () => {
        const updateResult = update(request.result as QuestionDraft | undefined);
        result = updateResult.value;
        if (updateResult.draft) store.put(updateResult.draft, key);
      };
      transaction.oncomplete = () => resolve(result!);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  };

  return {
    async list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE_STORE, "readonly");
        const store = transaction.objectStore(DATABASE_STORE);
        const keys = store.getAllKeys();
        const values = store.getAll();
        transaction.oncomplete = () =>
          resolve(
            Object.fromEntries(
              keys.result.map((key, index) => [String(key), values.result[index] as QuestionDraft]),
            ),
          );
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    },
    updateAnswer: (key, questionId, answer) =>
      mutate(key, (current) => {
        if (current?.submission) return { value: current };
        const draft = { answers: { ...current?.answers, [questionId]: answer } };
        return { value: draft, draft };
      }),
    prepare: (key, submission) =>
      mutate(key, (current) => {
        if (current?.submission) return { value: current.submission };
        const draft = { answers: submission.answers, submission };
        return { value: submission, draft };
      }),
    async remove(key) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(DATABASE_STORE, "readwrite");
        transaction.objectStore(DATABASE_STORE).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    },
    async importLegacy(records) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(DATABASE_STORE, "readwrite");
        const store = transaction.objectStore(DATABASE_STORE);
        for (const [key, draft] of Object.entries(records)) {
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result === undefined) store.put(draft, key);
          };
        }
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}

export function createQuestionDraftRepository(
  storage: QuestionDraftStorage,
  legacyReader: () => Record<string, QuestionDraft> = readLegacyDrafts,
) {
  const store = create<QuestionDraftState>(() => ({
    drafts: {},
    ready: false,
    error: null,
    setAnswer: async () => undefined,
    prepare: async (_key, submission) => submission,
    remove: async () => undefined,
  }));
  let hydration: Promise<void> | null = null;
  const pendingByKey = new Map<string, Promise<void>>();
  const editVersionByKey = new Map<string, number>();
  const commitListeners = new Set<() => void>();
  const setError = (error: unknown) =>
    store.setState({
      error: error instanceof Error ? error.message : "Could not save this answer on this device.",
    });
  const load = () =>
    (hydration ??= (async () => {
      const legacy = legacyReader();
      if (Object.keys(legacy).length > 0) {
        await storage.importLegacy(legacy);
        clearImportedLegacyDrafts(Object.keys(legacy));
      }
      const drafts = await storage.list();
      store.setState({ drafts, ready: true, error: null });
    })().catch((error) => {
      hydration = null;
      setError(error);
      throw error;
    }));
  const enqueue = (key: string, operation: () => Promise<void>): Promise<void> => {
    const previous = pendingByKey.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    pendingByKey.set(key, task);
    void task
      .finally(() => {
        if (pendingByKey.get(key) === task) pendingByKey.delete(key);
      })
      .catch(() => undefined);
    return task;
  };
  const setAnswer = async (key: string, questionId: string, answer: string | string[]) => {
    await load();
    const current = store.getState().drafts[key];
    if (current?.submission) return;
    const optimistic = { answers: { ...current?.answers, [questionId]: answer } };
    const editVersion = (editVersionByKey.get(key) ?? 0) + 1;
    editVersionByKey.set(key, editVersion);
    store.setState((state) => ({ drafts: { ...state.drafts, [key]: optimistic } }));
    await enqueue(key, async () => {
      const persisted = await storage.updateAnswer(key, questionId, answer);
      if (editVersionByKey.get(key) === editVersion) {
        store.setState((state) => ({ drafts: { ...state.drafts, [key]: persisted }, error: null }));
      }
      for (const listener of commitListeners) listener();
    }).catch((error) => {
      setError(error);
      throw error;
    });
  };
  const prepare = async (key: string, submission: QuestionSubmission) => {
    await load();
    await pendingByKey.get(key);
    const persisted = await storage.prepare(key, submission);
    store.setState((state) => ({
      drafts: { ...state.drafts, [key]: { answers: persisted.answers, submission: persisted } },
      error: null,
    }));
    for (const listener of commitListeners) listener();
    return persisted;
  };
  const remove = async (key: string) => {
    await load();
    await pendingByKey.get(key);
    await storage.remove(key);
    editVersionByKey.delete(key);
    store.setState((state) => {
      if (!state.drafts[key]) return state;
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts, error: null };
    });
    for (const listener of commitListeners) listener();
  };
  const reload = async () => {
    await load();
    const drafts = await storage.list();
    store.setState({ drafts, error: null });
  };
  store.setState({ setAnswer, prepare, remove });
  const subscribeCommits = (listener: () => void) => {
    commitListeners.add(listener);
    return () => commitListeners.delete(listener);
  };
  return { store, load, reload, setAnswer, prepare, remove, subscribeCommits };
}

export const questionDrafts = createQuestionDraftRepository(createIndexedDbQuestionDraftStorage());
export const useQuestionDraftStore = questionDrafts.store;

export function reloadQuestionDrafts(): Promise<void> {
  return questionDrafts.reload();
}

if (typeof BroadcastChannel !== "undefined") {
  const channel = new BroadcastChannel("cozea-question-drafts");
  channel.addEventListener("message", () => void questionDrafts.reload().catch(() => undefined));
  questionDrafts.subscribeCommits(() => channel.postMessage("changed"));
}

const submissionsByRepository = new WeakMap<
  ReturnType<typeof createQuestionDraftRepository>,
  Map<string, Promise<void>>
>();

export function submitQuestionOnceInRepository(
  repository: ReturnType<typeof createQuestionDraftRepository>,
  threadId: string,
  request: PendingUserInput,
  dispatch: (submission: QuestionSubmission) => Promise<void>,
): Promise<void> {
  const submissions =
    submissionsByRepository.get(repository) ?? new Map<string, Promise<void>>();
  submissionsByRepository.set(repository, submissions);
  const key = questionDraftKey(threadId, request);
  const current = submissions.get(key);
  if (current) return current;
  const task = (async () => {
    await repository.load();
    const pendingDraft = repository.store.getState().drafts[key];
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      const answer = resolvePendingUserInputAnswer(
        question,
        pendingUserInputDraftFromAnswer(question, pendingDraft?.answers[question.id]),
      );
      if (answer === null) throw new Error("Answer each question before sending.");
      answers[question.id] = answer;
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const submission = await repository.prepare(key, {
      commandId: `cozea-question:${hash}`,
      createdAt: new Date().toISOString(),
      answers,
    });
    await dispatch(submission);
    await repository.remove(key);
  })();
  submissions.set(key, task);
  void task.finally(() => submissions.delete(key)).catch(() => undefined);
  return task;
}

/** Durable identity plus in-window coalescing; the server owns atomic resolution. */
export function submitQuestionOnce(
  threadId: string,
  request: PendingUserInput,
  dispatch: (submission: QuestionSubmission) => Promise<void>,
): Promise<void> {
  return submitQuestionOnceInRepository(questionDrafts, threadId, request, dispatch);
}
