import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./base";

export const ORCHESTRATION_RPC_METHODS = {
  getSnapshot: "orchestration.getSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  subscribe: "orchestration.subscribe",
} as const;

export type OrchestrationRpcMethod =
  (typeof ORCHESTRATION_RPC_METHODS)[keyof typeof ORCHESTRATION_RPC_METHODS];

export const OrchestrationDispatchInput = Schema.Struct({
  command: Schema.Unknown,
});
export type OrchestrationDispatchInput = typeof OrchestrationDispatchInput.Type;

export const OrchestrationSubscribeInput = Schema.Struct({
  /** Optional sequence cursor — when omitted, streams live events only. */
  afterSequence: Schema.optionalKey(Schema.Number),
});
export type OrchestrationSubscribeInput = typeof OrchestrationSubscribeInput.Type;

export const OrchestrationDomainEventEnvelope = Schema.Struct({
  _tag: Schema.Literal("domainEvent"),
  sequence: Schema.Number,
  event: Schema.Unknown,
  at: TrimmedNonEmptyString,
});
export type OrchestrationDomainEventEnvelope = typeof OrchestrationDomainEventEnvelope.Type;

export const OrchestrationRpcEvent = Schema.Union([
  OrchestrationDomainEventEnvelope,
  Schema.Struct({
    _tag: Schema.Literal("completed"),
    at: TrimmedNonEmptyString,
  }),
]);
export type OrchestrationRpcEvent = typeof OrchestrationRpcEvent.Type;
