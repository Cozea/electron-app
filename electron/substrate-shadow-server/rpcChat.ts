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
import { getSharedSubstrateNdjsonWriter } from "../substrate/obs";
import {
  bootstrapSubstrateProviderRegistry,
  type SubstrateProviderDriverRegistry,
} from "../substrate/providers";
import { readSubstratePrimaryFlags } from "../substrate/flags";
import type { SubstrateDriverKind } from "../substrate/providers/types";
import { bridgeAssistantTurn } from "./assistantWsBridge";

export const SUBSTRATE_RPC_WS_PATH = "/rpc";

export const SUBSTRATE_RPC_METHODS = {
  health: "health",
  chatSend: "chat.send",
  chatSubscribe: "chat.subscribe",
} as const;

export type RpcChatTurnMode = "echo" | "bridged" | "provider";

export interface RpcChatTurn {
  readonly turnId: string;
  readonly text: string;
  readonly mode: RpcChatTurnMode;
  readonly replyPreview: string;
  readonly createdAtMs: number;
  readonly providerId?: string;
}

export interface AttachRpcChatOptions {
  readonly server: import("node:http").Server;
  readonly pin?: string;
  readonly rpcChatEnabled: boolean;
  /**
   * When true, `chat.send` / subscribe prefer the Phase 3 provider registry
   * (OpenCode full driver or legacy adapters). Falls back to echo/bridge on
   * materialize failure or when the registry is disabled.
   */
  readonly providersEnabled?: boolean;
  /** When true, prefer assistant WS bridge over echo when reachable. */
  readonly primaryEnabled?: boolean;
  readonly assistantHttpOrigin?: string;
  readonly onLog?: (line: string) => void;
  /** Override env for provider bootstrap (tests). */
  readonly env?: NodeJS.ProcessEnv;
  /** Inject a registry (tests). When unset, bootstraps from flag/env. */
  readonly providerRegistry?: SubstrateProviderDriverRegistry | null;
}

export interface RpcChatHandle {
  readonly enabled: boolean;
  readonly path: typeof SUBSTRATE_RPC_WS_PATH;
  readonly providersEnabled: boolean;
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

function resolveDriverKind(raw: unknown): SubstrateDriverKind {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim() as SubstrateDriverKind;
  }
  return "opencode";
}

/**
 * Attach a minimal JSON RPC WebSocket at `/rpc` for Phase 2 flagged chat.
 *
 * When `providersEnabled` (Phase 3) is on, `chat.send` materializes a substrate
 * provider driver and replies with `mode: "provider"`. Otherwise (or on
 * materialize failure) falls back to the Phase 2 echo/bridge path.
 */
export function attachRpcChat(options: AttachRpcChatOptions): RpcChatHandle {
  if (!options.rpcChatEnabled) {
    return {
      enabled: false,
      path: SUBSTRATE_RPC_WS_PATH,
      providersEnabled: false,
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
  const env = options.env ?? process.env;
  const providersEnabled = options.providersEnabled === true;
  const primaryEnabled =
    options.primaryEnabled === true || readSubstratePrimaryFlags(env).enabled;

  let providerRegistry: SubstrateProviderDriverRegistry | null = null;
  if (providersEnabled) {
    if (options.providerRegistry !== undefined) {
      providerRegistry = options.providerRegistry;
    } else {
      providerRegistry = bootstrapSubstrateProviderRegistry({
        env: { ...env, COZEA_SUBSTRATE_PROVIDERS: "1" },
      });
    }
  }

  const obs = getSharedSubstrateNdjsonWriter({ env });
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
    `rpc chat enabled path=${SUBSTRATE_RPC_WS_PATH} flag=${SUBSTRATE_RPC_CHAT_FLAG} bridge=${assistantHttpOrigin} providers=${providersEnabled}`,
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

  async function tryProviderTurn(input: {
    readonly text: string;
    readonly providerId: SubstrateDriverKind;
  }): Promise<RpcChatTurn | null> {
    if (!providerRegistry?.enabled) {
      return null;
    }
    try {
      const instance = await providerRegistry.materialize({
        driverKind: input.providerId,
      });
      obs.writeSpan({
        name: "substrate.provider.materialize",
        attrs: {
          driverKind: instance.driverKind,
          instanceId: instance.instanceId,
          implementation: instance.implementation,
        },
      });
      const state = await instance.snapshot.run();
      const turnId = randomUUID();
      const replyPreview = `[substrate-provider:${instance.driverKind}] phase=${state.phase} ${input.text}`;
      return {
        turnId,
        text: input.text,
        mode: "provider",
        replyPreview,
        createdAtMs: Date.now(),
        providerId: instance.driverKind,
      };
    } catch (error) {
      options.onLog?.(
        `provider materialize failed; falling back to echo/bridge: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      obs.writeSpan({
        name: "substrate.provider.materialize_failed",
        attrs: {
          driverKind: input.providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

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
            phase: providersEnabled ? 3 : 2,
            pin,
            rpcChat: true,
            providers: providersEnabled,
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

        const providerId = resolveDriverKind(payload.providerId);
        let turn: RpcChatTurn | null = null;
        let providerAttemptFailed = false;
        if (providersEnabled) {
          turn = await tryProviderTurn({ text, providerId });
          providerAttemptFailed = turn === null;
        }

        if (!turn) {
          const bridge = await probeAssistantBridge(assistantHttpOrigin);
          const shouldUseBridge =
            bridge.status === "reachable" &&
            (primaryEnabled || providerAttemptFailed);

          if (shouldUseBridge) {
            try {
              const threadId =
                typeof payload.threadId === "string" ? payload.threadId.trim() : undefined;
              const bridged = await bridgeAssistantTurn({
                text,
                threadId,
                providerId: typeof payload.providerId === "string" ? payload.providerId : undefined,
                assistantOrigin: assistantHttpOrigin,
              });
              const turnId = randomUUID();
              turn = {
                turnId,
                text,
                mode: "bridged",
                replyPreview: bridged.replyText,
                createdAtMs: Date.now(),
                ...(typeof payload.providerId === "string"
                  ? { providerId: payload.providerId }
                  : {}),
              };
            } catch (error) {
              options.onLog?.(
                `assistant bridge failed; falling back to echo: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }

          if (!turn) {
            const mode: "echo" | "bridged" =
              bridge.status === "reachable" ? "bridged" : "echo";
            const turnId = randomUUID();
            const replyPreview =
              mode === "bridged"
                ? `[substrate-bridge] assistant runtime reachable; echo for now: ${text}`
                : `[substrate-echo] ${text}`;
            turn = {
              turnId,
              text,
              mode,
              replyPreview,
              createdAtMs: Date.now(),
            };
          }
        }

        turns.set(turn.turnId, turn);

        obs.writeSpan({
          name: "substrate.rpc.chat.send_accepted",
          attrs: {
            turnId: turn.turnId,
            mode: turn.mode,
            providersEnabled,
            ...(turn.providerId ? { providerId: turn.providerId } : {}),
          },
        });

        sendJson(ws, {
          type: "res",
          id: request.id,
          ok: true,
          result: {
            turnId: turn.turnId,
            accepted: true,
            mode: turn.mode,
            replyPreview: turn.replyPreview,
            ...(turn.providerId ? { providerId: turn.providerId } : {}),
            ...(turn.mode !== "provider"
              ? {
                  todo: providersEnabled
                    ? "Provider materialize failed; used echo/bridge fallback"
                    : "Enable COZEA_SUBSTRATE_PROVIDERS=1 for provider-backed chat",
                }
              : {}),
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
    providersEnabled,
    dispose() {
      options.server.off("upgrade", onUpgrade);
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
      void providerRegistry?.disposeAll();
    },
  };
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
}
