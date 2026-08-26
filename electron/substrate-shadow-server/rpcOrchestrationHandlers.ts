import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";

import { ORCHESTRATION_RPC_METHODS } from "@cozea/contracts";

import {
  getSharedOrchestrationRpcProxy,
  type OrchestrationRpcProxy,
} from "./orchestrationRpcProxy";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

export interface OrchestrationRpcHandlerOptions {
  readonly proxy?: OrchestrationRpcProxy;
  readonly onLog?: (line: string) => void;
}

/**
 * Handle substrate RPC orchestration methods on an open WebSocket connection.
 * Returns true when the method was handled.
 */
export async function handleOrchestrationRpcRequest(input: {
  readonly ws: WebSocket;
  readonly id: string;
  readonly method: string;
  readonly payload: unknown;
  readonly options?: OrchestrationRpcHandlerOptions;
}): Promise<boolean> {
  const proxy = input.options?.proxy ?? getSharedOrchestrationRpcProxy();
  const payload = asRecord(input.payload) ?? {};

  switch (input.method) {
    case ORCHESTRATION_RPC_METHODS.getSnapshot: {
      const result = await proxy.getSnapshot();
      sendJson(input.ws, { type: "res", id: input.id, ok: true, result });
      return true;
    }
    case ORCHESTRATION_RPC_METHODS.dispatchCommand: {
      const command = "command" in payload ? payload.command : payload;
      const result = await proxy.dispatchCommand(command);
      sendJson(input.ws, { type: "res", id: input.id, ok: true, result });
      return true;
    }
    case ORCHESTRATION_RPC_METHODS.getTurnDiff: {
      const result = await proxy.getTurnDiff(payload);
      sendJson(input.ws, { type: "res", id: input.id, ok: true, result });
      return true;
    }
    case ORCHESTRATION_RPC_METHODS.getFullThreadDiff: {
      const result = await proxy.getFullThreadDiff(payload);
      sendJson(input.ws, { type: "res", id: input.id, ok: true, result });
      return true;
    }
    case ORCHESTRATION_RPC_METHODS.replayEvents: {
      const result = await proxy.replayEvents(payload);
      sendJson(input.ws, { type: "res", id: input.id, ok: true, result });
      return true;
    }
    case ORCHESTRATION_RPC_METHODS.subscribe: {
      sendJson(input.ws, {
        type: "res",
        id: input.id,
        ok: true,
        result: { subscribed: true },
      });

      const afterSequence =
        typeof payload.afterSequence === "number" ? payload.afterSequence : null;

      const unsubscribe = await proxy.subscribeDomainEvents((event) => {
        if (afterSequence !== null && event.sequence <= afterSequence) {
          return;
        }
        sendJson(input.ws, {
          type: "event",
          id: input.id,
          event: {
            _tag: "domainEvent",
            sequence: event.sequence,
            event,
            at: nowIso(),
          },
        });
      });

      input.ws.on("close", () => {
        unsubscribe();
      });
      return true;
    }
    default:
      return false;
  }
}

export function isOrchestrationRpcMethod(method: string): boolean {
  return (Object.values(ORCHESTRATION_RPC_METHODS) as string[]).includes(method);
}
