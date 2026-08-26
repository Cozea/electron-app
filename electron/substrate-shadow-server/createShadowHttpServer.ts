import http from "node:http";

import {
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_T3_PIN_SHA,
} from "../substrate/constants";
import { attachRpcChat, type RpcChatHandle } from "./rpcChat";

export interface ShadowServerReadyPayload {
  readonly ok: true;
  readonly role: "shadow";
  readonly phase: 1 | 2;
  readonly flagId: typeof SUBSTRATE_SHADOW_SERVER_FLAG;
  readonly pin: string;
  readonly host: string;
  readonly port: number;
  readonly startedAtMs: number;
  readonly pid: number;
  readonly rpcChat: boolean;
  readonly rpcPath: "/rpc" | null;
}

export interface CreateShadowHttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly pin?: string;
  readonly startedAtMs?: number;
  readonly pid?: number;
  readonly rpcChatEnabled?: boolean;
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
  const phase: 1 | 2 = rpcChatEnabled ? 2 : 1;

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
    rpcPath: rpcChatEnabled ? "/rpc" : null,
  };

  const server = http.createServer((request, response) => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
    options.onRequestLog?.(
      `${new Date().toISOString()} ${method} ${requestUrl.pathname} from ${request.socket.remoteAddress ?? "unknown"}`,
    );

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

      if (requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(
          rpcChatEnabled
            ? "cozea substrate shadow server (phase 2 rpc chat)\n"
            : "cozea substrate shadow server (phase 1)\n",
        );
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
