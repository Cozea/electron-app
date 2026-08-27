import { Schema } from "effect";

/** Cozea collab IPC contracts — never implemented by upstream T3 server. */

export const CollabRoomId = Schema.String.pipe(Schema.brand("CollabRoomId"));
export type CollabRoomId = typeof CollabRoomId.Type;

export const CollabJournalEntry = Schema.Struct({
  roomId: CollabRoomId,
  updateId: Schema.String,
  ciphertext: Schema.String,
  createdAtMs: Schema.Number,
});
export type CollabJournalEntry = typeof CollabJournalEntry.Type;
