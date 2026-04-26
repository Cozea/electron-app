// @ts-nocheck
/**
 * ProviderSessionRuntimeRepository - Repository interface for provider runtime sessions.
 *
 * Owns persistence operations for provider runtime metadata and resume cursors.
 *
 * @module ProviderSessionRuntimeRepository
 */
import {
  IsoDateTime,
  ModelSelection,
  ProviderInteractionMode,
  ProviderSessionRuntimeStatus,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@cozea/assistant-contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProviderSessionRuntimeRepositoryError } from "../Errors.ts";

export const ProviderSessionRuntimePayload = Schema.Struct({
  cwd: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  lastRuntimeEvent: Schema.optional(Schema.String),
  lastRuntimeEventAt: Schema.optional(IsoDateTime),
  sessionUpdatedAt: Schema.optional(IsoDateTime),
});
export type ProviderSessionRuntimePayload = typeof ProviderSessionRuntimePayload.Type;

export const ProviderSessionRuntime = Schema.Struct({
  threadId: ThreadId,
  providerName: Schema.String,
  adapterKey: Schema.String,
  runtimeMode: RuntimeMode,
  status: ProviderSessionRuntimeStatus,
  lastSeenAt: IsoDateTime,
  resumeCursor: Schema.NullOr(Schema.Unknown),
  runtimePayload: Schema.NullOr(ProviderSessionRuntimePayload),
});
export type ProviderSessionRuntime = typeof ProviderSessionRuntime.Type;

export const GetProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
export type GetProviderSessionRuntimeInput = typeof GetProviderSessionRuntimeInput.Type;

export const DeleteProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
export type DeleteProviderSessionRuntimeInput = typeof DeleteProviderSessionRuntimeInput.Type;

/**
 * ProviderSessionRuntimeRepositoryShape - Service API for provider runtime records.
 */
export interface ProviderSessionRuntimeRepositoryShape {
  /**
   * Insert or replace a provider runtime row.
   *
   * Upserts by canonical `threadId`, including JSON payload/cursor fields.
   */
  readonly upsert: (
    runtime: ProviderSessionRuntime,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  /**
   * Read provider runtime state by canonical thread id.
   */
  readonly getByThreadId: (
    input: GetProviderSessionRuntimeInput,
  ) => Effect.Effect<Option.Option<ProviderSessionRuntime>, ProviderSessionRuntimeRepositoryError>;

  /**
   * List all provider runtime rows.
   *
   * Returned in ascending last-seen order.
   */
  readonly list: () => Effect.Effect<
    ReadonlyArray<ProviderSessionRuntime>,
    ProviderSessionRuntimeRepositoryError
  >;

  /**
   * Delete provider runtime state by canonical thread id.
   */
  readonly deleteByThreadId: (
    input: DeleteProviderSessionRuntimeInput,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;
}

/**
 * ProviderSessionRuntimeRepository - Service tag for provider runtime persistence.
 */
export class ProviderSessionRuntimeRepository extends ServiceMap.Service<
  ProviderSessionRuntimeRepository,
  ProviderSessionRuntimeRepositoryShape
>()("cozea/assistant-runtime/persistence/Services/ProviderSessionRuntime/ProviderSessionRuntimeRepository") {}
