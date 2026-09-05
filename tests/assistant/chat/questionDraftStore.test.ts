import { beforeEach, expect, it, vi } from "vitest";
import { ApprovalRequestId } from "@cozea/assistant-contracts";
import type { PendingUserInput } from "@/features/assistant/chat/session-logic";
const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  get length() {
    return values.size;
  },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
});
const {
  useQuestionDraftStore: store,
  questionDraftKey,
  submitQuestionOnce,
  reloadQuestionDrafts,
} = await import("@/features/assistant/questionDraftStore");
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
beforeEach(() => {
  values.clear();
  store.setState({ drafts: {} });
});
function answer() {
  store.getState().setAnswer(key, "scope", "native-local");
  store.getState().setAnswer(key, "detail", "Details");
}
it("restores answers independently across requests and rejects damaged storage", () => {
  answer();
  const otherKey = questionDraftKey("another-thread", request);
  store.getState().setAnswer(otherKey, "scope", "another");
  values.set("cozea:question-draft:v1:damaged", '{"answers":5}');
  store.setState({ drafts: {} });
  reloadQuestionDrafts();
  expect(store.getState().drafts[key]?.answers.scope).toBe("native-local");
  expect(store.getState().drafts[otherKey]?.answers.scope).toBe("another");
  expect(store.getState().drafts.damaged).toBeUndefined();
});
it("coalesces double clicks and preserves exact identity and answers after lost acknowledgement and reload", async () => {
  answer();
  let rejectDispatch!: (error: Error) => void;
  const dispatch = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectDispatch = reject;
      }),
  );
  const first = submitQuestionOnce("thread", request, dispatch);
  expect(submitQuestionOnce("thread", request, dispatch)).toBe(first);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  const persisted = store.getState().drafts[key]?.submission;
  rejectDispatch(new Error("lost acknowledgement"));
  await expect(first).rejects.toThrow("lost acknowledgement");
  store.setState({ drafts: {} });
  reloadQuestionDrafts();
  store.getState().setAnswer(key, "detail", "changed");
  const retry = vi.fn(async () => undefined);
  await submitQuestionOnce("thread", request, retry);
  expect(retry).toHaveBeenCalledWith(persisted);
  expect(store.getState().drafts[key]).toBeUndefined();
  expect(values.size).toBe(0);
});
it("does not send incomplete answers", async () => {
  store.getState().setAnswer(key, "scope", "native-local");
  const dispatch = vi.fn();
  await expect(submitQuestionOnce("thread", request, dispatch)).rejects.toThrow(
    "Answer each question",
  );
  expect(dispatch).not.toHaveBeenCalled();
});
