import http from "node:http";

import {
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_T3_PIN_SHA,
} from "../substrate/constants";

export interface ShadowServerReadyPayload {
  readonly ok: true;
  readonly role: "shadow";
  readonly phase: 1;
  readonly flagId: typeof SUBSTRATE_SHADOW_SERVER_FLAG;
  readonly pin: string;
  readonly host: string;
  readonly port: number;
  readonly startedAtMs: number;
  readonly pid: number;
}

export interface CreateShadowHttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly pin?: string;
  readonly startedAtMs?: number;
  readonly pid?: number;
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

  const readyPayload: ShadowServerReadyPayload = {
    ok: true,
    role: "shadow",
    phase: 1,
    flagId: SUBSTRATE_SHADOW_SERVER_FLAG,
    pin,
    host: options.host,
    port: options.port,
    startedAtMs,
    pid,
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
        response.end("cozea substrate shadow server (phase 1)\n");
        return;
      }
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

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
          options.onListening?.({ host, port });
          resolve({ host, port });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, options.host);
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
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
