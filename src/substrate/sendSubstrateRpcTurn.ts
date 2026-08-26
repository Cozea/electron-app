import type { ChatEvent, ChatSendResult } from "@cozea/contracts";

import {
  createSubstrateRpcChatAdapter,
  type SubstrateRpcChatAdapterOptions,
} from "./rpcChatAdapter";
import { isSubstrateRpcChatEnabled } from "./rpcChatFlags";

export interface SubstrateRpcTurnResult {
  readonly send: ChatSendResult;
  readonly events: ChatEvent[];
  readonly assistantText: string;
}

/**
 * Send one user turn through the flagged substrate `/rpc` path and collect
 * streamed assistant deltas. Used when primary mode skips the in-process runtime.
 */
export async function sendSubstrateRpcTurn(input: {
  readonly threadId: string;
  readonly text: string;
  readonly providerId?: string;
  readonly modelSelection?: {
    readonly provider: string;
    readonly model: string;
    readonly instanceId?: string;
  };
  readonly shadowBaseUrl?: string;
  readonly WebSocketImpl?: typeof WebSocket;
}): Promise<SubstrateRpcTurnResult> {
  if (!isSubstrateRpcChatEnabled()) {
    throw new Error("Substrate RPC chat is not enabled.");
  }
  const options: SubstrateRpcChatAdapterOptions = {
    shadowBaseUrl: input.shadowBaseUrl,
    WebSocketImpl: input.WebSocketImpl,
  };
  const client = createSubstrateRpcChatAdapter(options);
  if (!client) {
    throw new Error("Substrate RPC chat client could not be created.");
  }

  try {
    await client.connect();
    const send = await client.send({
      threadId: input.threadId,
      text: input.text,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelSelection
        ? {
            modelSelection: {
              provider: input.modelSelection.provider,
              model: input.modelSelection.model,
              ...(input.modelSelection.instanceId
                ? { instanceId: input.modelSelection.instanceId }
                : {}),
            },
          }
        : {}),
    });
    const events: ChatEvent[] = [];
    let assistantText = "";
    for await (const event of client.subscribe({ turnId: send.turnId })) {
      events.push(event);
      if (event._tag === "delta" && typeof event.text === "string") {
        assistantText += event.text;
      }
    }
    return { send, events, assistantText };
  } finally {
    await client.close();
  }
}
