import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  ChatEvent,
  ChatSendInput,
  ChatSendResult,
  ChatSubscribeInput,
} from "./chat";
import { HealthInput, HealthResult } from "./health";
import { SUBSTRATE_RPC_METHODS } from "./protocol";

export const HealthRpc = Rpc.make(SUBSTRATE_RPC_METHODS.health, {
  payload: HealthInput,
  success: HealthResult,
});

export const ChatSendRpc = Rpc.make(SUBSTRATE_RPC_METHODS.chatSend, {
  payload: ChatSendInput,
  success: ChatSendResult,
});

export const ChatSubscribeRpc = Rpc.make(SUBSTRATE_RPC_METHODS.chatSubscribe, {
  payload: ChatSubscribeInput,
  success: ChatEvent,
  stream: true,
});

/** Typed Effect RPC surface for Phase 2 substrate chat (wire transport is JSON-WS). */
export const SubstrateRpcs = RpcGroup.make(HealthRpc, ChatSendRpc, ChatSubscribeRpc);
