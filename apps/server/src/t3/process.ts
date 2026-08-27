import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_T3_SERVER_HOST,
  DEFAULT_T3_SERVER_PORT,
  VENDOR_T3_SERVER_BIN,
  VENDOR_T3_SERVER_PKG,
  assertNodeVersionForT3Server,
  vendorT3ServerBinExists,
} from "./paths.ts";
import { extractPairingToken, authenticateT3Server } from "@cozea/client-runtime";

export interface StartT3ServerProcessOptions {
  readonly host?: string;
  readonly port?: number;
  readonly baseDir?: string;
  readonly onLog?: (line: string) => void;
}

export interface T3ServerProcessHandle {
  readonly baseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly pairingToken: string;
  readonly stop: () => Promise<void>;
}

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65535) return fallback;
  return value;
}

export function resolveDefaultT3BaseDir(): string {
  const fromEnv = process.env.COZEA_T3_SERVER_BASE_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const shadowLogDir = process.env.COZEA_SUBSTRATE_SHADOW_LOG_DIR?.trim();
  if (shadowLogDir) {
    return path.join(path.dirname(shadowLogDir), "t3-server");
  }
  return path.join(os.homedir(), ".cozea", "t3-server");
}

async function waitForEnvironment(baseUrl: string, deadlineMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`${baseUrl}/.well-known/t3/environment`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for T3 environment at ${baseUrl}`);
}

export async function startT3ServerProcess(
  options: StartT3ServerProcessOptions = {},
): Promise<T3ServerProcessHandle> {
  assertNodeVersionForT3Server();
  if (!vendorT3ServerBinExists()) {
    throw new Error(
      `Missing T3 server bundle at ${VENDOR_T3_SERVER_BIN}. Run pnpm install/build in vendor/t3code.`,
    );
  }

  const host = options.host?.trim() || process.env.COZEA_T3_SERVER_HOST?.trim() || DEFAULT_T3_SERVER_HOST;
  const port =
    options.port ??
    readPort(process.env.COZEA_T3_SERVER_PORT, DEFAULT_T3_SERVER_PORT);
  const baseDir =
    options.baseDir?.trim() ||
    process.env.COZEA_T3_SERVER_BASE_DIR?.trim() ||
    resolveDefaultT3BaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  const baseUrl = `http://${host}:${port}`;

  let log = "";
  const append = (chunk: Buffer | string) => {
    const text = chunk.toString();
    log += text;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        options.onLog?.(line);
      }
    }
  };

  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [VENDOR_T3_SERVER_BIN, "serve", "--port", String(port), "--host", host, "--no-browser", "--base-dir", baseDir],
    {
      cwd: VENDOR_T3_SERVER_PKG,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`T3 server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
  });

  try {
    await Promise.race([waitForEnvironment(baseUrl), exited]);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  const pairingToken = extractPairingToken(log);

  return {
    baseUrl,
    host,
    port,
    pairingToken,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
