import { Schema } from "effect";

import { TrimmedNonEmptyString, TrimmedString } from "./base";
import {
  ChatEvent,
  ChatSendInput,
  ChatSendResult,
  ChatSubscribeInput,
} from "./chat";
import { HealthInput, HealthResult } from "./health";

import { ORCHESTRATION_RPC_METHODS } from "./orchestration";

/** Canonical WS path on the shadow server for Phase 2 RPC chat. */
export const SUBSTRATE_RPC_WS_PATH = "/rpc";

export const SUBSTRATE_RPC_METHODS = {
  health: "health",
  chatSend: "chat.send",
  chatSubscribe: "chat.subscribe",
  ...ORCHESTRATION_RPC_METHODS,
} as const;

export type SubstrateRpcMethod =
  (typeof SUBSTRATE_RPC_METHODS)[keyof typeof SUBSTRATE_RPC_METHODS];

export const SubstrateRpcRequest = Schema.Struct({
  type: Schema.Literal("req"),
  id: TrimmedNonEmptyString,
  method: TrimmedNonEmptyString,
  payload: Schema.Unknown,
});
export type SubstrateRpcRequest = typeof SubstrateRpcRequest.Type;

export const SubstrateRpcErrorBody = Schema.Struct({
  message: TrimmedNonEmptyString,
  code: Schema.optionalKey(TrimmedString),
});

export const SubstrateRpcResponseOk = Schema.Struct({
  type: Schema.Literal("res"),
  id: TrimmedNonEmptyString,
  ok: Schema.Literal(true),
  result: Schema.Unknown,
});

export const SubstrateRpcResponseErr = Schema.Struct({
  type: Schema.Literal("res"),
  id: TrimmedNonEmptyString,
  ok: Schema.Literal(false),
  error: SubstrateRpcErrorBody,
});

export const SubstrateRpcResponse = Schema.Union([
  SubstrateRpcResponseOk,
  SubstrateRpcResponseErr,
]);
export type SubstrateRpcResponse = typeof SubstrateRpcResponse.Type;

export const SubstrateRpcStreamEvent = Schema.Struct({
  type: Schema.Literal("event"),
  id: TrimmedNonEmptyString,
  event: ChatEvent,
});
export type SubstrateRpcStreamEvent = typeof SubstrateRpcStreamEvent.Type;

export const SubstrateRpcStreamDone = Schema.Struct({
  type: Schema.Literal("done"),
  id: TrimmedNonEmptyString,
});
export type SubstrateRpcStreamDone = typeof SubstrateRpcStreamDone.Type;

export const SubstrateRpcServerMessage = Schema.Union([
  SubstrateRpcResponse,
  SubstrateRpcStreamEvent,
  SubstrateRpcStreamDone,
]);
export type SubstrateRpcServerMessage = typeof SubstrateRpcServerMessage.Type;

export const MethodPayloadSchemas = {
  [SUBSTRATE_RPC_METHODS.health]: HealthInput,
  [SUBSTRATE_RPC_METHODS.chatSend]: ChatSendInput,
  [SUBSTRATE_RPC_METHODS.chatSubscribe]: ChatSubscribeInput,
} as const;

export const MethodResultSchemas = {
  [SUBSTRATE_RPC_METHODS.health]: HealthResult,
  [SUBSTRATE_RPC_METHODS.chatSend]: ChatSendResult,
} as const;
