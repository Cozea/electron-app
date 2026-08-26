import { randomUUID } from "node:crypto";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationEvent,
} from "@cozea/assistant-contracts";

import type { OrchestrationRpcProxy } from "./orchestrationRpcProxy";

export interface RpcBridgedChatTurnInput {
  readonly text: string;
  readonly threadId?: string;
  readonly providerId?: string;
  readonly modelSelection?: {
    readonly provider: "codex" | "opencode" | "claudeAgent" | "cursor";
    readonly model: string;
    readonly instanceId?: string;
  };
  readonly timeoutMs?: number;
  readonly proxy?: OrchestrationRpcProxy;
}

export interface RpcBridgedChatTurnResult {
  readonly replyText: string;
  readonly mode: "orchestration-rpc";
}

function resolveModelSelection(
  providerId: string | undefined,
  explicit?: RpcBridgedChatTurnInput["modelSelection"],
): RpcBridgedChatTurnInput["modelSelection"] {
  if (explicit?.provider && explicit.model.trim()) {
    return explicit;
  }
  switch (providerId) {
    case "opencode":
      return { provider: "opencode", model: "opencode/default" };
    case "claudeAgent":
      return { provider: "claudeAgent", model: "claude-sonnet-4-20250514" };
    case "cursor":
      return { provider: "cursor", model: "cursor/default" };
    case "codex":
    default:
      return { provider: "codex", model: "gpt-5.3-codex" };
  }
}

function readThreadMessageSent(event: OrchestrationEvent): {
  readonly threadId: string;
  readonly messageId: string;
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
} | null {
  if (event.type !== "thread.message-sent") {
    return null;
  }
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload) {
    return null;
  }
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const streaming = payload.streaming === true;
  if (!threadId || !messageId || !role) {
    return null;
  }
  return { threadId, messageId, role, text, streaming };
}

/**
 * Execute one chat turn via native orchestration RPC (no assistantWsBridge).
 */
export async function executeRpcBridgedChatTurn(
  input: RpcBridgedChatTurnInput,
): Promise<RpcBridgedChatTurnResult> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const proxy = input.proxy;
  if (!proxy) {
    throw new Error("orchestration RPC proxy required (T3 backend unavailable)");
  }
  const threadId = input.threadId?.trim();
  if (!threadId) {
    throw new Error("threadId is required for orchestration RPC chat turns");
  }

  const modelSelection = resolveModelSelection(input.providerId, input.modelSelection);
  const createdAt = new Date().toISOString();
  const assistantTexts = new Map<string, string>();
  let latestAssistantText = "";
  let turnCompleted = false;

  const unsubscribe = await proxy.subscribeDomainEvents((event) => {
    if (event.type === "thread.session-set") {
      const payload = event.payload as Record<string, unknown> | null;
      const session = payload?.session as Record<string, unknown> | null;
      const status = typeof session?.status === "string" ? session.status : "";
      if (
        payload?.threadId === threadId &&
        (status === "completed" || status === "stopped" || status === "error")
      ) {
        turnCompleted = true;
      }
    }
    const message = readThreadMessageSent(event);
    if (message?.threadId === threadId && message.role === "assistant") {
      assistantTexts.set(message.messageId, message.text);
      latestAssistantText = message.text;
      if (!message.streaming) {
        turnCompleted = true;
      }
    }
  });

  try {
    await proxy.dispatchCommand({
      type: "thread.turn.start",
      commandId: randomUUID(),
      threadId,
      message: {
        messageId: randomUUID(),
        role: "user",
        text: input.text,
        attachments: [],
      },
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt,
    });

    const deadline = Date.now() + timeoutMs;
    while (!turnCompleted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    unsubscribe();
  }

  const replyText =
    latestAssistantText.trim().length > 0
      ? latestAssistantText
      : Array.from(assistantTexts.values()).join("\n").trim();

  return {
    replyText: replyText.length > 0 ? replyText : `[orchestration-rpc] turn accepted: ${input.text}`,
    mode: "orchestration-rpc",
  };
}
