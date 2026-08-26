/**
 * Phase 1 substrate shadow server child process.
 *
 * Spawned by Electron when `cozea.substrate.shadowServer` is enabled.
 * Does **not** replace the in-process assistant runtime (ws://127.0.0.1:3773).
 * Full T3 `apps/server` body lands behind this same readiness contract later.
 */
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_T3_PIN_SHA,
} from "../substrate/constants";
import { createShadowHttpServer } from "./createShadowHttpServer";

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

const host = process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || DEFAULT_SUBSTRATE_SHADOW_HOST;
const port = readPort(process.env.COZEA_SUBSTRATE_SHADOW_PORT, DEFAULT_SUBSTRATE_SHADOW_PORT);
const logDir = process.env.COZEA_SUBSTRATE_SHADOW_LOG_DIR?.trim();
const logFilePath = logDir
  ? path.join(logDir, "substrate-shadow-server.log")
  : null;

function appendLog(line: string): void {
  const stamped = `[substrate-shadow] ${line}`;
  console.log(stamped);
  if (!logFilePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, `${stamped}\n`, "utf8");
  } catch (error) {
    console.error("[substrate-shadow] failed to write log file", error);
  }
}

const handle = createShadowHttpServer({
  host,
  port,
  pin: process.env.COZEA_SUBSTRATE_T3_PIN?.trim() || SUBSTRATE_T3_PIN_SHA,
  onRequestLog: (line) => appendLog(line),
  onListening: (info) => {
    appendLog(`listening on http://${info.host}:${info.port}`);
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

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  appendLog(`shutting down (${signal})`);
  try {
    await handle.stop();
    appendLog("stopped");
    process.exit(0);
  } catch (error) {
    appendLog(`stop failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

void handle.start().catch((error: unknown) => {
  appendLog(`failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
