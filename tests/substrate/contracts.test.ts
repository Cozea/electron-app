import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ChatEvent,
  ChatSendInput,
  ChatSendResult,
  HealthResult,
  SUBSTRATE_RPC_METHODS,
  SUBSTRATE_RPC_WS_PATH,
  SubstrateRpcs,
} from "@cozea/contracts";

describe("@cozea/contracts", () => {
  it("exposes health + chat RPC method names and ws path", () => {
    expect(SUBSTRATE_RPC_WS_PATH).toBe("/rpc");
    expect(SUBSTRATE_RPC_METHODS.health).toBe("health");
    expect(SUBSTRATE_RPC_METHODS.chatSend).toBe("chat.send");
    expect(SUBSTRATE_RPC_METHODS.chatSubscribe).toBe("chat.subscribe");
    expect(SubstrateRpcs.requests.size).toBeGreaterThanOrEqual(3);
  });

  it("decodes health + chat.send payloads", () => {
    const health = Schema.decodeSync(HealthResult)({
      ok: true,
      role: "shadow",
      phase: 2,
      pin: "deadbeef",
      rpcChat: true,
      bridge: {
        status: "unreachable",
        assistantHttpUrl: "http://127.0.0.1:3773",
        detail: "down",
      },
      checkedAt: new Date().toISOString(),
    });
    expect(health.phase).toBe(2);

    const input = Schema.decodeSync(ChatSendInput)({ text: "hello" });
    expect(input.text).toBe("hello");

    const result = Schema.decodeSync(ChatSendResult)({
      turnId: "turn_1",
      accepted: true,
      mode: "echo",
      replyPreview: "hi",
    });
    expect(result.turnId).toBe("turn_1");

    const event = Schema.decodeSync(ChatEvent)({
      _tag: "delta",
      turnId: "turn_1",
      text: "hi",
      at: new Date().toISOString(),
    });
    expect(event._tag).toBe("delta");
  });
});
