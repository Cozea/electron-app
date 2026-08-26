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
    },
  });

  const handle = createShadowHttpServer({
    rpcChatEnabled: substrateFlags.rpcChat,
    providersEnabled: substrateFlags.providers,
    primaryEnabled: substrateFlags.primary,
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
        });
      }
    },
  });

  await handle.start();
  return {
    stop: () => handle.stop(),
  };
}
