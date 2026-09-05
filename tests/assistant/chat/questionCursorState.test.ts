import { expect, it } from "vitest";
import { questionCursorKey, retainQuestionCursors, setQuestionCursor } from "@/features/assistant/chat/questionCursorState";

it("retains A and B independently across edits without changing the previous state", () => {
  const a = questionCursorKey("thread", "request", "A");
  const b = questionCursorKey("thread", "request", "B");
  const first = setQuestionCursor({}, a, 3);
  const next = setQuestionCursor(first, b, 2);
  expect(next[a]).toBe(3);
  expect(next[b]).toBe(2);
  expect(first).toEqual({ [a]: 3 });
  expect(setQuestionCursor(next, b, 2)).toBe(next);
});

it("isolates request and thread identities and prunes only resolved questions", () => {
  const keys = [questionCursorKey("one", "request", "A"), questionCursorKey("two", "request", "A"), questionCursorKey("one", "other", "A")];
  expect(new Set(keys).size).toBe(3);
  const cursors = Object.fromEntries(keys.map((key, index) => [key, index]));
  expect(retainQuestionCursors(cursors, new Set(keys))).toBe(cursors);
  expect(retainQuestionCursors(cursors, new Set([keys[0]!]))).toEqual({ [keys[0]!]: 0 });
});
