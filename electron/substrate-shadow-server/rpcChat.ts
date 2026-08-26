import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  ASSISTANT_RUNTIME_READINESS_PATH,
  DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN,
  SUBSTRATE_RPC_CHAT_FLAG,
  SUBSTRATE_T3_PIN_SHA,
} from "../substrate/constants";

export const SUBSTRATE_RPC_WS_PATH = "/rpc";

export const SUBSTRATE_RPC_METHODS = {
  health: "health",
  chatSend: "chat.send",
  chatSubscribe: "chat.subscribe",
} as const;

export interface RpcChatTurn {
  readonly turnId: string;
  readonly text: string;
  readonly mode: "echo" | "bridged";
  readonly replyPreview: string;
  readonly createdAtMs: number;
}

export interface AttachRpcChatOptions {
  readonly server: import("node:http").Server;
  readonly pin?: string;
  readonly rpcChatEnabled: boolean;
  readonly assistantHttpOrigin?: string;
  readonly onLog?: (line: string) => void;
}

export interface RpcChatHandle {
  readonly enabled: boolean;
  readonly path: typeof SUBSTRATE_RPC_WS_PATH;
  dispose(): void;
}

interface RpcRequest {
  readonly type: "req";
  readonly id: string;
  readonly method: string;
  readonly payload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function probeAssistantBridge(
  assistantHttpOrigin: string,
): Promise<{ status: "reachable" | "unreachable"; detail: string }> {
  const readyUrl = new URL(ASSISTANT_RUNTIME_READINESS_PATH, assistantHttpOrigin).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(readyUrl, { signal: controller.signal });
    if (response.ok) {
      return { status: "reachable", detail: `GET ${readyUrl} → ${response.status}` };
    }
    return {
      status: "unreachable",
      detail: `GET ${readyUrl} → ${response.status}`,
    };
  } catch (error) {
    return {
      status: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attach a minimal JSON RPC WebSocket at `/rpc` for Phase 2 flagged chat.
 *
 * `chat.send` / `chat.subscribe` currently echo with a thin readiness bridge probe
 * against the in-process assistant runtime (:3773). Real provider drivers land in Phase 3.
 */
export function attachRpcChat(options: AttachRpcChatOptions): RpcChatHandle {
  if (!options.rpcChatEnabled) {
    return {
      enabled: false,
      path: SUBSTRATE_RPC_WS_PATH,
      dispose() {
        // no-op
      },
    };
  }

  const pin = options.pin ?? SUBSTRATE_T3_PIN_SHA;
  const assistantHttpOrigin =
    options.assistantHttpOrigin?.trim() ||
    process.env.COZEA_ASSISTANT_RUNTIME_HTTP_ORIGIN?.trim() ||
    DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN;
  const turns = new Map<string, RpcChatTurn>();
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== SUBSTRATE_RPC_WS_PATH) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  };

  options.server.on("upgrade", onUpgrade);
  options.onLog?.(
    `rpc chat enabled path=${SUBSTRATE_RPC_WS_PATH} flag=${SUBSTRATE_RPC_CHAT_FLAG} bridge=${assistantHttpOrigin}`,
  );

  wss.on("connection", (ws) => {
    options.onLog?.("rpc client connected");
    ws.on("message", (data) => {
      void handleMessage(ws, data).catch((error) => {
        options.onLog?.(
          `rpc handler error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  });

  async function handleMessage(ws: WebSocket, data: RawData): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (!record || record.type !== "req" || typeof record.id !== "string") {
      return;
    }
    const request = record as unknown as RpcRequest;
    try {
      if (request.method === SUBSTRATE_RPC_METHODS.health) {
        const bridge = await probeAssistantBridge(assistantHttpOrigin);
        sendJson(ws, {
          type: "res",
          id: request.id,
          ok: true,
          result: {
            ok: true,
            role: "shadow",
            phase: 2,
            pin,
            rpcChat: true,
            bridge: {
              status: bridge.status,
              assistantHttpUrl: assistantHttpOrigin,
              detail: bridge.detail,
            },
            checkedAt: nowIso(),
          },
        });
        return;
      }

      if (request.method === SUBSTRATE_RPC_METHODS.chatSend) {
        const payload = asRecord(request.payload) ?? {};
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          sendJson(ws, {
            type: "res",
            id: request.id,
            ok: false,
            error: { message: "chat.send requires non-empty text", code: "invalid_payload" },
          });
          return;
        }

        const bridge = await probeAssistantBridge(assistantHttpOrigin);
        const mode: "echo" | "bridged" = bridge.status === "reachable" ? "bridged" : "echo";
        const turnId = randomUUID();
        const replyPreview =
          mode === "bridged"
            ? `[substrate-bridge] assistant runtime reachable; echo for now: ${text}`
            : `[substrate-echo] ${text}`;
        const turn: RpcChatTurn = {
          turnId,
          text,
          mode,
          replyPreview,
          createdAtMs: Date.now(),
        };
        turns.set(turnId, turn);

        sendJson(ws, {
          type: "res",
          id: request.id,
          ok: true,
          result: {
            turnId,
            accepted: true,
            mode,
            replyPreview,
            todo: "Phase 3: replace echo/bridge with provider drivers over substrate RPC",
          },
        });
        return;
      }

      if (request.method === SUBSTRATE_RPC_METHODS.chatSubscribe) {
        const payload = asRecord(request.payload) ?? {};
        const turnId = typeof payload.turnId === "string" ? payload.turnId : "";
        const turn = turns.get(turnId);
        if (!turn) {
          sendJson(ws, {
            type: "res",
            id: request.id,
            ok: false,
            error: { message: `Unknown turnId: ${turnId}`, code: "not_found" },
          });
          return;
        }

        // Acknowledge subscription start as a unary ok, then stream events.
        sendJson(ws, {
          type: "res",
          id: request.id,
          ok: true,
          result: { subscribed: true, turnId },
        });

        sendJson(ws, {
          type: "event",
          id: request.id,
          event: { _tag: "started", turnId, at: nowIso() },
        });
        sendJson(ws, {
          type: "event",
          id: request.id,
          event: { _tag: "delta", turnId, text: turn.replyPreview, at: nowIso() },
        });
        sendJson(ws, {
          type: "event",
          id: request.id,
          event: { _tag: "completed", turnId, mode: turn.mode, at: nowIso() },
        });
        sendJson(ws, { type: "done", id: request.id });
        return;
      }

      sendJson(ws, {
        type: "res",
        id: request.id,
        ok: false,
        error: { message: `Unknown method: ${request.method}`, code: "unknown_method" },
      });
    } catch (error) {
      sendJson(ws, {
        type: "res",
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: "internal",
        },
      });
    }
  }

  return {
    enabled: true,
    path: SUBSTRATE_RPC_WS_PATH,
    dispose() {
      options.server.off("upgrade", onUpgrade);
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
    },
  };
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
}
