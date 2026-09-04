import { isHostUpdateRequest } from "../../../shared/hostUpdateControl.ts";
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_T3_PIN_SHA,
} from "../../../apps/desktop/electron/substrate/constants";
import { readSubstrateFeatureFlags } from "../../../apps/desktop/electron/substrate/flags";
import { getSharedSubstrateNdjsonWriter } from "../../../apps/desktop/electron/substrate/obs";
import { createShadowHttpServer } from "../../../apps/desktop/electron/substrate-shadow-server/createShadowHttpServer";
import type { OrchestrationRpcBackend } from "../../../apps/desktop/electron/substrate-shadow-server/rpcOrchestrationHandlers";
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
    t3Handle = await bootstrapT3Server({
      onLog: (line) => appendLog(`[t3] ${line}`),
    });
    orchestrationBackend = t3Handle.proxy;
    appendLog(`T3 server ready at ${t3Handle.process.baseUrl}`);
  } else {
    appendLog(
      "COZEA_T3_SERVER=0: legacy assistant runtime boot removed; enable T3 for orchestration",
    );
  }

  const handle = createShadowHttpServer({
    rpcChatEnabled: substrateFlags.rpcChat,
    providersEnabled: substrateFlags.providers && orchestrationBackend === undefined,
    primaryEnabled: substrateFlags.primary,
    t3ServerEnabled: orchestrationBackend !== undefined,
    orchestrationBackend,
    t3RpcSession:
      t3Handle !== null
        ? {
            baseUrl: t3Handle.process.baseUrl,
            issueWsTicket: () => t3Handle!.issueWsTicket(),
          }
        : undefined,
    host,
    port,
    pin: process.env.COZEA_SUBSTRATE_T3_PIN?.trim() || SUBSTRATE_T3_PIN_SHA,
    onRequestLog: (line) => appendLog(line),
    onListening: (info) => {
      appendLog(`listening on http://${info.host}:${info.port}`);
      if (substrateFlags.t3Server && orchestrationBackend !== undefined) {
        appendLog("T3 orchestration owner active (legacy :3773 boot removed)");
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

  const onHostUpdate = (message: unknown) => {
    if (!isHostUpdateRequest(message)) return;
    const request = t3Handle?.process.controlUpdate(message) ?? Promise.reject(new Error("Chat server is unavailable"));
    const reply = (success: boolean) => {
      if (!process.connected || !process.send) return;
      try {
        process.send({ type: "cozea:host-update-result", requestId: message.requestId, action: message.action, success }, () => undefined);
      } catch { /* The parent may exit between the connected check and send. */ }
    };
    void request.then(() => reply(true), () => reply(false));
  };
  process.on("message", onHostUpdate);
  await handle.start();
  return {
    stop: async () => {
      process.off("message", onHostUpdate);
      await handle.stop();
      if (t3Handle) {
        await t3Handle.stop();
        t3Handle = null;
      }
    },
  };
}
