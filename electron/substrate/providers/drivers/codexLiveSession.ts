import { randomUUID } from "node:crypto";

import { ThreadId, type ProviderEvent } from "@cozea/assistant-contracts";

import { CodexAppServerManager } from "../codex/codexAppServerManager.ts";
import type {
  SubstrateLiveTurnHandle,
  SubstrateLiveTurnInput,
  SubstrateLiveTurnResult,
} from "../types";

const DEFAULT_TURN_TIMEOUT_MS = 120_000;

export interface CodexLiveSessionConfig {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly homePath?: string;
  readonly model?: string;
  readonly turnTimeoutMs?: number;
}

export interface CodexLiveSessionHooks {
  readonly sendTurn?: (input: SubstrateLiveTurnInput) => Promise<SubstrateLiveTurnResult>;
}

function readTurnFailedMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const turn = (payload as Record<string, unknown>).turn;
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return undefined;
  }
  const status = (turn as Record<string, unknown>).status;
  if (status !== "failed") {
    return undefined;
  }
  const error = (turn as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return "Turn failed";
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0 ? message : "Turn failed";
}

/**
 * Substrate Codex live turn runtime — wraps `CodexAppServerManager` for RPC chat.
 * Inject `hooks.sendTurn` in tests to avoid spawning the real app-server.
 */
export function createCodexLiveSession(
  config: CodexLiveSessionConfig,
  hooks: CodexLiveSessionHooks = {},
): SubstrateLiveTurnHandle {
  if (hooks.sendTurn) {
    return {
      sendTurn: hooks.sendTurn,
      dispose: async () => undefined,
    };
  }

  const manager = new CodexAppServerManager();
  const sessions = new Map<string, ThreadId>();

  return {
    async sendTurn(input: SubstrateLiveTurnInput): Promise<SubstrateLiveTurnResult> {
      const sessionKey = input.threadId ?? "default";
      let threadId = sessions.get(sessionKey);
      if (!threadId) {
        threadId = ThreadId.makeUnsafe(input.threadId ?? randomUUID());
        sessions.set(sessionKey, threadId);
        await manager.startSession({
          threadId,
          binaryPath: config.binaryPath,
          cwd: input.cwd ?? config.cwd ?? process.cwd(),
          ...(config.homePath ? { homePath: config.homePath } : {}),
          ...(config.model ? { model: config.model } : {}),
          runtimeMode: "full-access",
        });
      }

      const deltas: string[] = [];
      let completed = false;
      let failed = false;
      let failureMessage: string | undefined;

      const onEvent = (event: ProviderEvent) => {
        if (event.threadId !== threadId) {
          return;
        }
        if (
          event.kind === "notification" &&
          event.method === "item/agentMessage/delta" &&
          event.textDelta
        ) {
          deltas.push(event.textDelta);
        }
        if (event.kind === "notification" && event.method === "turn/completed") {
          completed = true;
          failureMessage = readTurnFailedMessage(event.payload);
          failed = failureMessage !== undefined;
        }
      };

      manager.on("event", onEvent);
      try {
        const start = await manager.sendTurn({
          threadId,
          input: input.text,
          ...(input.model ? { model: input.model } : {}),
          ...(config.model && !input.model ? { model: config.model } : {}),
        });

        const timeoutMs = config.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        while (!completed && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (!completed) {
          return {
            turnId: start.turnId,
            replyText: deltas.join(""),
            status: "timeout",
            error: `Codex turn did not complete within ${timeoutMs}ms`,
          };
        }

        return {
          turnId: start.turnId,
          replyText: deltas.join(""),
          status: failed ? "failed" : "completed",
          ...(failureMessage ? { error: failureMessage } : {}),
        };
      } catch (error) {
        return {
          turnId: randomUUID(),
          replyText: deltas.join(""),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        manager.off("event", onEvent);
      }
    },
    dispose: async () => {
      for (const threadId of sessions.values()) {
        manager.stopSession(threadId);
      }
      sessions.clear();
    },
  };
}
