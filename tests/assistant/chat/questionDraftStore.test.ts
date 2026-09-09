import { beforeEach, expect, it, vi } from "vitest";
import { ApprovalRequestId } from "@cozea/assistant-contracts";
import type { PendingUserInput } from "@/features/assistant/chat/session-logic";
import {
  createQuestionDraftRepository,
  questionDraftKey,
  submitQuestionOnceInRepository,
  type QuestionDraft,
  type QuestionDraftStorage,
  type QuestionSubmission,
} from "@/features/assistant/questionDraftStore";

function memoryStorage() {
  const rows = new Map<string, QuestionDraft>();
  let writes = 0;
  let failImport = false;
  const storage: QuestionDraftStorage = {
    list: async () => Object.fromEntries(rows),
    updateAnswer: async (key, questionId, answer) => {
      writes += 1;
      const current = rows.get(key);
      if (current?.submission) return structuredClone(current);
      const draft = { answers: { ...current?.answers, [questionId]: answer } };
      rows.set(key, structuredClone(draft));
      return draft;
    },
    prepare: async (key, submission) => {
      writes += 1;
      const current = rows.get(key);
      if (current?.submission) return structuredClone(current.submission);
      rows.set(key, structuredClone({ answers: submission.answers, submission }));
      return submission;
    },
    remove: async (key) => {
      writes += 1;
      rows.delete(key);
    },
    importLegacy: async (records) => {
      if (failImport) throw new Error("migration interrupted");
      for (const [key, draft] of Object.entries(records)) {
        if (!rows.has(key)) rows.set(key, structuredClone(draft));
      }
    },
  };
  return {
    rows,
    storage,
    writeCount: () => writes,
    failImport: (value: boolean) => {
      failImport = value;
    },
  };
}

const request: PendingUserInput = {
  requestId: ApprovalRequestId.makeUnsafe("request"),
  createdAt: "2026-09-05T00:00:00Z",
  responseMode: "message",
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "Where?",
      options: [{ label: "Local", description: "", value: "native-local" }],
      allowCustomAnswer: false,
    },
    { id: "detail", header: "Detail", question: "Details?", options: [] },
  ],
};
const key = questionDraftKey("thread", request);
let backend: ReturnType<typeof memoryStorage>;
let repository: ReturnType<typeof createQuestionDraftRepository>;

beforeEach(async () => {
  backend = memoryStorage();
  repository = createQuestionDraftRepository(backend.storage, () => ({}));
  await repository.load();
});

async function answer() {
  await repository.setAnswer(key, "scope", "native-local");
  await repository.setAnswer(key, "detail", "Details");
}

it("restores answers independently across repositories", async () => {
  await answer();
  const otherKey = questionDraftKey("another-thread", request);
  await repository.setAnswer(otherKey, "scope", "another");

  const restored = createQuestionDraftRepository(backend.storage, () => ({}));
  await restored.load();
  expect(restored.store.getState().drafts[key]?.answers.scope).toBe("native-local");
  expect(restored.store.getState().drafts[otherKey]?.answers.scope).toBe("another");
});

it("coalesces double clicks and preserves exact identity after lost acknowledgement", async () => {
  await answer();
  let rejectDispatch!: (error: Error) => void;
  const dispatch = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectDispatch = reject;
      }),
  );
  const first = submitQuestionOnceInRepository(repository, "thread", request, dispatch);
  expect(submitQuestionOnceInRepository(repository, "thread", request, dispatch)).toBe(first);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  const persisted = repository.store.getState().drafts[key]?.submission;
  rejectDispatch(new Error("lost acknowledgement"));
  await expect(first).rejects.toThrow("lost acknowledgement");

  const restored = createQuestionDraftRepository(backend.storage, () => ({}));
  await restored.load();
  await restored.setAnswer(key, "detail", "changed");
  const retry = vi.fn(async () => undefined);
  await submitQuestionOnceInRepository(restored, "thread", request, retry);
  expect(retry).toHaveBeenCalledWith(persisted);
  expect(restored.store.getState().drafts[key]).toBeUndefined();
  expect(backend.rows.size).toBe(0);
});

it("does not send incomplete answers", async () => {
  await repository.setAnswer(key, "scope", "native-local");
  const dispatch = vi.fn();
  await expect(
    submitQuestionOnceInRepository(repository, "thread", request, dispatch),
  ).rejects.toThrow("Answer each question");
  expect(dispatch).not.toHaveBeenCalled();
});

it("persists and submits native multi-select arrays without trimming identities", async () => {
  const multiRequest = {
    ...request,
    questions: [
      {
        ...request.questions[0]!,
        multiSelect: true,
        options: [
          { label: "Same", description: "", value: " first\t" },
          { label: "Same", description: "", value: "second" },
        ],
      },
    ],
  };
  await repository.setAnswer(key, "scope", [" first\t", "second"]);
  const restored = createQuestionDraftRepository(backend.storage, () => ({}));
  await restored.load();
  const dispatch = vi.fn(async () => undefined);
  await submitQuestionOnceInRepository(restored, "thread", multiRequest, dispatch);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ answers: { scope: [" first\t", "second"] } }),
  );
});

it("serializes local edits and prevents another window from changing a frozen submission", async () => {
  const second = createQuestionDraftRepository(backend.storage, () => ({}));
  await second.load();
  await answer();
  const submission: QuestionSubmission = {
    commandId: "fixed-command",
    createdAt: "2026-09-05T00:00:01Z",
    answers: { scope: "native-local", detail: "Details" },
  };
  await repository.prepare(key, submission);
  await second.setAnswer(key, "detail", "overwritten");
  expect(second.store.getState().drafts[key]?.submission).toEqual(submission);
  expect(backend.rows.get(key)?.answers.detail).toBe("Details");
});

it("keeps migration resumable when the first import is interrupted", async () => {
  const legacy = { [key]: { answers: { scope: "native-local" } } };
  backend.failImport(true);
  const first = createQuestionDraftRepository(backend.storage, () => legacy);
  await expect(first.load()).rejects.toThrow("migration interrupted");
  expect(backend.rows.size).toBe(0);

  backend.failImport(false);
  await first.load();
  expect(first.store.getState().drafts[key]?.answers.scope).toBe("native-local");
});

it("performs storage writes asynchronously after hydration", async () => {
  const update = repository.setAnswer(key, "scope", "native-local");
  expect(backend.writeCount()).toBe(0);
  await update;
  expect(backend.writeCount()).toBe(1);
});
