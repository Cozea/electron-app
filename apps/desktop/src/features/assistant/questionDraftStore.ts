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
interface QuestionDraftState {
  drafts: Record<string, QuestionDraft>;
  setAnswer: (key: string, questionId: string, answer: string | string[]) => void;
  prepare: (key: string, submission: QuestionSubmission) => QuestionSubmission;
  remove: (key: string) => void;
}
const STORAGE_PREFIX = "cozea:question-draft:v1:";

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
      !Object.values(answers).every((answer) => typeof answer === "string" || (Array.isArray(answer) && answer.every(value => typeof value === "string")))
    )
      return undefined;
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
      )
        return undefined;
    }
    return value as QuestionDraft;
  } catch {
    return undefined;
  }
}

function readDrafts(): Record<string, QuestionDraft> {
  const drafts: Record<string, QuestionDraft> = {};
  if (typeof localStorage === "undefined") return drafts;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const draft = decodeDraft(localStorage.getItem(key));
    if (draft) drafts[key.slice(STORAGE_PREFIX.length)] = draft;
  }
  return drafts;
}

// Each request has its own storage record: a second window cannot overwrite
// unrelated answers by persisting an older copy of the entire store.
export const useQuestionDraftStore = create<QuestionDraftState>()((set, get) => ({
  drafts: readDrafts(),
  setAnswer: (key, questionId, answer) => {
    const current = decodeDraft(localStorage.getItem(STORAGE_PREFIX + key)) ?? get().drafts[key];
    if (current?.submission) return;
    const draft = { answers: { ...current?.answers, [questionId]: answer } };
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(draft));
    set((state) => ({ drafts: { ...state.drafts, [key]: draft } }));
  },
  prepare: (key, submission) => {
    const existing =
      decodeDraft(localStorage.getItem(STORAGE_PREFIX + key))?.submission ??
      get().drafts[key]?.submission;
    if (existing) return existing;
    const draft = { answers: submission.answers, submission };
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(draft));
    set((state) => ({ drafts: { ...state.drafts, [key]: draft } }));
    return submission;
  },
  remove: (key) => {
    localStorage.removeItem(STORAGE_PREFIX + key);
    set((state) => {
      if (!state.drafts[key]) return state;
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    });
  },
}));

export function reloadQuestionDrafts(): void {
  useQuestionDraftStore.setState({ drafts: readDrafts() });
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) reloadQuestionDrafts();
  });
}

const submissions = new Map<string, Promise<void>>();

/** Durable identity plus in-window coalescing; the server owns atomic resolution. */
export function submitQuestionOnce(
  threadId: string,
  request: PendingUserInput,
  dispatch: (submission: QuestionSubmission) => Promise<void>,
): Promise<void> {
  const key = questionDraftKey(threadId, request);
  const current = submissions.get(key);
  if (current) return current;
  const task = (async () => {
    const draft = useQuestionDraftStore.getState().drafts[key];
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      const answer = resolvePendingUserInputAnswer(question, pendingUserInputDraftFromAnswer(question, draft?.answers[question.id]));
      if (answer === null) throw new Error("Answer each question before sending.");
      answers[question.id] = answer;
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const submission = useQuestionDraftStore.getState().prepare(key, {
      commandId: `cozea-question:${hash}`,
      createdAt: new Date().toISOString(),
      answers,
    });
    await dispatch(submission);
    useQuestionDraftStore.getState().remove(key);
  })();
  submissions.set(key, task);
  void task.finally(() => submissions.delete(key)).catch(() => undefined);
  return task;
}
