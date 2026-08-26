import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "./base";

export const ChatSendInput = Schema.Struct({
  text: TrimmedNonEmptyString,
  threadId: Schema.optionalKey(TrimmedNonEmptyString),
  projectId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ChatSendInput = typeof ChatSendInput.Type;

export const ChatSendMode = Schema.Literals(["echo", "bridged"]);
export type ChatSendMode = typeof ChatSendMode.Type;

export const ChatSendResult = Schema.Struct({
  turnId: TrimmedNonEmptyString,
  accepted: Schema.Literal(true),
  mode: ChatSendMode,
  replyPreview: TrimmedString,
  /** TODO(phase3): replace echo/bridge with real provider drivers. */
  todo: Schema.optionalKey(TrimmedString),
});
export type ChatSendResult = typeof ChatSendResult.Type;

export const ChatSubscribeInput = Schema.Struct({
  turnId: TrimmedNonEmptyString,
});
export type ChatSubscribeInput = typeof ChatSubscribeInput.Type;

export const ChatEventStarted = Schema.Struct({
  _tag: Schema.Literal("started"),
  turnId: TrimmedNonEmptyString,
  at: IsoDateTime,
});

export const ChatEventDelta = Schema.Struct({
  _tag: Schema.Literal("delta"),
  turnId: TrimmedNonEmptyString,
  text: TrimmedString,
  at: IsoDateTime,
});

export const ChatEventCompleted = Schema.Struct({
  _tag: Schema.Literal("completed"),
  turnId: TrimmedNonEmptyString,
  mode: ChatSendMode,
  at: IsoDateTime,
});

export const ChatEventError = Schema.Struct({
  _tag: Schema.Literal("error"),
  turnId: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  at: IsoDateTime,
});

export const ChatEvent = Schema.Union([
  ChatEventStarted,
  ChatEventDelta,
  ChatEventCompleted,
  ChatEventError,
]);
export type ChatEvent = typeof ChatEvent.Type;
