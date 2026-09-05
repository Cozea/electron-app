export type QuestionCursors = Readonly<Record<string, number>>;

export function questionCursorKey(
  threadId: string | undefined,
  requestId: string,
  questionId: string,
): string {
  return JSON.stringify([threadId, requestId, questionId]);
}

export function setQuestionCursor(
  cursors: QuestionCursors,
  key: string,
  cursor: number,
): QuestionCursors {
  return cursors[key] === cursor ? cursors : { ...cursors, [key]: cursor };
}

/** Resolved requests must not retain an unbounded history of local carets. */
export function retainQuestionCursors(
  cursors: QuestionCursors,
  activeKeys: ReadonlySet<string>,
): QuestionCursors {
  const entries = Object.entries(cursors).filter(([key]) => activeKeys.has(key));
  return entries.length === Object.keys(cursors).length ? cursors : Object.fromEntries(entries);
}
