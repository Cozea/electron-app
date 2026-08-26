import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_T3_PIN_SHA,
} from "../../../electron/substrate/constants";
import { readSubstrateFeatureFlags } from "../../../electron/substrate/flags";
import { getSharedSubstrateNdjsonWriter } from "../../../electron/substrate/obs";
import { createShadowHttpServer } from "../../../electron/substrate-shadow-server/createShadowHttpServer";
import type { OrchestrationRpcBackend } from "../../../electron/substrate-shadow-server/rpcOrchestrationHandlers";
import { authenticateT3Server } from "@cozea/client-runtime";
import { bootstrapT3Server, type T3ServerBootstrapHandle } from "./t3Bootstrap.ts";

export interface BootstrapCozeaSubstrateServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly logDirectory?: string;
  readonly onLog?: (line: string) => void;
}

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65535) {
    return fallback;
  }
  return value;
}

/**
 * Bootstrap the Cozea substrate server (shadow HTTP + RPC + optional assistant runtime).
 * Called from the shadow child process entry (`electron/substrate-shadow-server/child.ts`).
 */
export async function bootstrapCozeaSubstrateServer(
  options: BootstrapCozeaSubstrateServerOptions = {},
): Promise<{ stop: () => Promise<void> }> {
  const host = options.host?.trim() || process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || DEFAULT_SUBSTRATE_SHADOW_HOST;
  const port =
    options.port ??
    readPort(process.env.COZEA_SUBSTRATE_SHADOW_PORT, DEFAULT_SUBSTRATE_SHADOW_PORT);
  const logDir = options.logDirectory?.trim() || process.env.COZEA_SUBSTRATE_SHADOW_LOG_DIR?.trim();
  const logFilePath = logDir ? path.join(logDir, "substrate-shadow-server.log") : null;

  const appendLog = (line: string): void => {
    const stamped = `[cozea-server] ${line}`;
    options.onLog?.(stamped);
    console.log(stamped);
    if (!logFilePath) return;
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
      fs.appendFileSync(logFilePath, `${stamped}\n`, "utf8");
    } catch (error) {
      console.error("[cozea-server] failed to write log file", error);
    }
  };

  const substrateFlags = readSubstrateFeatureFlags();
  const obs = getSharedSubstrateNdjsonWriter();
  obs.writeSpan({
    name: "cozea.server.start",
    attrs: {
      host,
      port,
      rpcChat: substrateFlags.rpcChat,
      providers: substrateFlags.providers,
      primary: substrateFlags.primary,
      t3Server: substrateFlags.t3Server,
    },
  });

  let t3Handle: T3ServerBootstrapHandle | null = null;
  let orchestrationBackend: OrchestrationRpcBackend | undefined;

  if (substrateFlags.t3Server) {
    try {
      t3Handle = await bootstrapT3Server({
        onLog: (line) => appendLog(`[t3] ${line}`),
      });
      orchestrationBackend = t3Handle.proxy;
      appendLog(`T3 server ready at ${t3Handle.process.baseUrl}`);
    } catch (error) {
      appendLog(
        `T3 server boot failed (legacy orchestration fallback): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const handle = createShadowHttpServer({
    rpcChatEnabled: substrateFlags.rpcChat,
    providersEnabled: substrateFlags.providers,
    primaryEnabled: substrateFlags.primary,
    t3ServerEnabled: orchestrationBackend !== undefined,
    orchestrationBackend,
    t3RpcSession:
      t3Handle !== null
        ? {
            baseUrl: t3Handle.process.baseUrl,
            issueWsTicket: () =>
              authenticateT3Server(t3Handle!.process.baseUrl, t3Handle!.process.pairingToken),
          }
        : undefined,
    host,
    port,
    pin: process.env.COZEA_SUBSTRATE_T3_PIN?.trim() || SUBSTRATE_T3_PIN_SHA,
    onRequestLog: (line) => appendLog(line),
    onListening: (info) => {
      appendLog(`listening on http://${info.host}:${info.port}`);
      if (substrateFlags.primary) {
        void (async () => {
          try {
            const { startAssistantRuntime } = await import(
              "../../../electron/assistant-runtime/boot.ts"
            );
            startAssistantRuntime();
            appendLog("assistant runtime started (ws://127.0.0.1:3773)");
          } catch (error) {
            appendLog(
              `assistant runtime start failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        })();
      }
      if (typeof process.send === "function") {
        process.send({
          type: "substrate-shadow.listening",
          host: info.host,
          port: info.port,
          readyPath: SUBSTRATE_SHADOW_READY_PATH,
          t3Server: orchestrationBackend !== undefined,
          t3ServerUrl: t3Handle?.process.baseUrl ?? null,
        });
      }
    },
  });

  await handle.start();
  return {
    stop: async () => {
      await handle.stop();
      if (t3Handle) {
        await t3Handle.stop();
        t3Handle = null;
      }
    },
  };
}
