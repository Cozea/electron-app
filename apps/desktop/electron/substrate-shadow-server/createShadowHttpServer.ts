import http from "node:http";

import {
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_T3_RPC_SESSION_PATH,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_T3_PIN_SHA,
} from "../substrate/constants";
import { attachRpcChat, type RpcChatHandle } from "./rpcChat";

export interface ShadowServerReadyPayload {
  readonly ok: true;
  readonly role: "shadow";
  readonly phase: 1 | 2 | 3;
  readonly flagId: typeof SUBSTRATE_SHADOW_SERVER_FLAG;
  readonly pin: string;
  readonly host: string;
  readonly port: number;
  readonly startedAtMs: number;
  readonly pid: number;
  readonly rpcChat: boolean;
  readonly providers: boolean;
  readonly t3Server: boolean;
  readonly rpcPath: "/rpc" | null;
}

export interface CreateShadowHttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly pin?: string;
  readonly startedAtMs?: number;
  readonly pid?: number;
  readonly rpcChatEnabled?: boolean;
  /** Phase 3 — route flagged RPC chat through the provider registry. */
  readonly providersEnabled?: boolean;
  /** Phase 5 — when true, bridge chat to assistant runtime in shadow process. */
  readonly primaryEnabled?: boolean;
  /** Phase T1 — vendored T3 server orchestration backend when dual-run is active. */
  readonly t3ServerEnabled?: boolean;
  readonly orchestrationBackend?: import("./rpcOrchestrationHandlers.ts").OrchestrationRpcBackend;
  /** Phase T2 — issue WS tickets for renderer native T3 RPC (localhost only). */
  readonly t3RpcSession?: {
    readonly baseUrl: string;
    readonly issueWsTicket: () => Promise<string>;
  };
  readonly onListening?: (info: { readonly host: string; readonly port: number }) => void;
  readonly onRequestLog?: (line: string) => void;
}

export interface ShadowHttpServerHandle {
  readonly server: http.Server;
  readonly readyPayload: ShadowServerReadyPayload;
  start(): Promise<{ readonly host: string; readonly port: number }>;
  stop(): Promise<void>;
}

function isReadyPath(urlPath: string): boolean {
  return urlPath === SUBSTRATE_SHADOW_READY_PATH || urlPath === "/healthz" || urlPath === "/ready";
}

export function createShadowHttpServer(
  options: CreateShadowHttpServerOptions,
): ShadowHttpServerHandle {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const pin = options.pin ?? SUBSTRATE_T3_PIN_SHA;
  const pid = options.pid ?? process.pid;
  const rpcChatEnabled = options.rpcChatEnabled === true;
  const providersEnabled = options.providersEnabled === true && rpcChatEnabled;
  const primaryEnabled = options.primaryEnabled === true;
  const t3ServerEnabled = options.t3ServerEnabled === true;
  const phase: 1 | 2 | 3 = providersEnabled ? 3 : rpcChatEnabled ? 2 : 1;

  const readyPayload: ShadowServerReadyPayload = {
    ok: true,
    role: "shadow",
    phase,
    flagId: SUBSTRATE_SHADOW_SERVER_FLAG,
    pin,
    host: options.host,
    port: options.port,
    startedAtMs,
    pid,
    rpcChat: rpcChatEnabled,
    providers: providersEnabled,
    t3Server: t3ServerEnabled,
    rpcPath: rpcChatEnabled ? "/rpc" : null,
  };

  const server = http.createServer((request, response) => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
    options.onRequestLog?.(
      `${new Date().toISOString()} ${method} ${requestUrl.pathname} from ${request.socket.remoteAddress ?? "unknown"}`,
    );

    // Renderer runs on localhost:5183, shadow on 127.0.0.1:4783 — allow cross-origin fetches.
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (method === "GET" || method === "HEAD") {
      if (isReadyPath(requestUrl.pathname)) {
        const body = JSON.stringify(readyPayload);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-cozea-substrate-role": "shadow",
        });
        if (method === "HEAD") {
          response.end();
        } else {
          response.end(body);
        }
        return;
      }

      if (requestUrl.pathname === SUBSTRATE_T3_RPC_SESSION_PATH) {
        if (!options.t3RpcSession) {
          response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: "t3_rpc_session_unavailable" }));
          return;
        }
        void (async () => {
          try {
            const wsTicket = await options.t3RpcSession!.issueWsTicket();
            response.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            response.end(
              JSON.stringify({
                ok: true,
                baseUrl: options.t3RpcSession!.baseUrl,
                wsTicket,
              }),
            );
          } catch (error) {
            response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
            response.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        })();
        return;
      }

      if (requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        const label = providersEnabled
          ? "cozea substrate shadow server (phase 3 providers)\n"
          : rpcChatEnabled
            ? "cozea substrate shadow server (phase 2 rpc chat)\n"
            : "cozea substrate shadow server (phase 1)\n";
        response.end(label);
        return;
      }
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  let rpcHandle: RpcChatHandle | null = null;

  return {
    server,
    readyPayload,
    start() {
      return new Promise<{ readonly host: string; readonly port: number }>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          const port =
            address && typeof address === "object" ? address.port : options.port;
          const host =
            address && typeof address === "object" && address.address
              ? address.address
              : options.host;
          rpcHandle = attachRpcChat({
            server,
            pin,
            rpcChatEnabled,
            providersEnabled,
            primaryEnabled,
            orchestrationBackend: options.orchestrationBackend,
            onLog: (line) => options.onRequestLog?.(line),
          });
          options.onListening?.({ host, port });
          resolve({ host, port });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, options.host);
      });
    },
    async stop() {
      rpcHandle?.dispose();
      rpcHandle = null;
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
