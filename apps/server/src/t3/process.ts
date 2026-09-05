import { requestHostUpdate, type HostUpdateRequest } from "../../../../shared/hostUpdateControl.ts";
import { spawn } from "node:child_process";
import { stopChildProcessVerified } from "../../../../shared/verifiedChildProcessStop.ts";
import fs from "node:fs";
import { isNativeWorkspaceAuthorizeRequest, requestNativeWorkspaceDecision, requestNativeWorkspaceControl, sendNativeWorkspaceMessage } from "../../../../shared/nativeWorkspaceIpc.ts";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_T3_SERVER_HOST,
  DEFAULT_T3_SERVER_PORT,
  VENDOR_T3_SERVER_BIN,
  VENDOR_T3_SERVER_PKG,
  assertNodeVersionForT3Server,
  assertT3RuntimeIdentity,
  vendorT3ServerBinExists,
} from "./paths.ts";
import { extractPairingToken } from "@cozea/client-runtime";

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
  readonly controlUpdate: (request: HostUpdateRequest) => Promise<void>;
  readonly controlWorkspace: (action: "stop" | "activate", root: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

type T3OutputSource = "stdout" | "stderr";

interface T3StartupOutputTracker {
  readonly append: (source: T3OutputSource, chunk: Buffer | string) => void;
  readonly pairingToken: Promise<string>;
}

const T3_CREDENTIAL_LINE = /^(?:Token|Pairing URL):\s*/;
const T3_PAIRING_QR_LINE = /^[ █▀▄]+$/;

export function createT3StartupOutputTracker(
  onLog?: (line: string) => void,
): T3StartupOutputTracker {
  const output = new Map<T3OutputSource, string>([
    ["stdout", ""],
    ["stderr", ""],
  ]);
  const pendingLines = new Map<T3OutputSource, string>([
    ["stdout", ""],
    ["stderr", ""],
  ]);
  let resolvePairingToken: (token: string) => void = () => undefined;
  let tokenResolved = false;
  const pairingToken = new Promise<string>((resolve) => {
    resolvePairingToken = resolve;
  });

  return {
    pairingToken,
    append: (source, chunk) => {
      const text = chunk.toString();

      if (!tokenResolved) {
        const sourceOutput = `${output.get(source) ?? ""}${text}`;
        output.set(source, sourceOutput);
        try {
          const token = extractPairingToken(sourceOutput);
          tokenResolved = true;
          output.clear();
          resolvePairingToken(token);
        } catch {
          // The startup credential can be emitted after HTTP readiness or across chunks.
        }
      }

      const buffered = `${pendingLines.get(source) ?? ""}${text}`;
      const lines = buffered.split(/\r?\n/);
      pendingLines.set(source, lines.pop() ?? "");
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed &&
          !T3_CREDENTIAL_LINE.test(trimmed) &&
          !T3_PAIRING_QR_LINE.test(line)
        ) {
          onLog?.(line);
        }
      }
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, deadlineMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      const response = await fetch(`${baseUrl}/.well-known/t3/environment`, {
        signal: AbortSignal.timeout(2_000),
      });
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

interface T3NodeLaunch {
  readonly executable: string;
  readonly environment: NodeJS.ProcessEnv;
}

function resolveT3ServerNodeLaunch(): T3NodeLaunch {
  const override = process.env.COZEA_T3_NODE?.trim() || process.env.NPM_NODE_EXECPATH?.trim();
  if (override) {
    return { executable: override, environment: { ...process.env } };
  }
  // Packaged shadow children can reuse Electron's embedded Node runtime instead
  // of requiring end users to install a compatible system Node separately.
  if (process.versions.electron) {
    return {
      executable: process.execPath,
      environment: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { executable: process.execPath, environment: { ...process.env } };
}

export async function startT3ServerProcess(
  options: StartT3ServerProcessOptions = {},
): Promise<T3ServerProcessHandle> {
  assertNodeVersionForT3Server();
  if (!vendorT3ServerBinExists()) {
    throw new Error(
      `Missing T3 server bundle at ${VENDOR_T3_SERVER_BIN}. Run bun run prepare:t3-runtime from the Cozea repository.`,
    );
  }

  assertT3RuntimeIdentity();

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

  const startupOutput = createT3StartupOutputTracker(options.onLog);

  const nodeLaunch = resolveT3ServerNodeLaunch();
  const child = spawn(
    nodeLaunch.executable,
    [VENDOR_T3_SERVER_BIN, "serve", "--port", String(port), "--host", host, "--no-browser", "--base-dir", baseDir],
    {
      cwd: VENDOR_T3_SERVER_PKG,
      env: { ...nodeLaunch.environment, COZEA_HOST_CONTINUATION: "1", COZEA_NATIVE_WORKSPACE_AUTHORITY: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );

  child.on("message", (message: unknown) => {
    if (!isNativeWorkspaceAuthorizeRequest(message)) return;
    void requestNativeWorkspaceDecision(process, message.cwd, message.operation).then(
      decision => sendNativeWorkspaceMessage(child, { type: "cozea:workspace-authorize-result", requestId: message.requestId, ...decision }),
      () => sendNativeWorkspaceMessage(child, { type: "cozea:workspace-authorize-result", requestId: message.requestId, allowed: false, sessionRoot: null }),
    );
  });
  child.stdout?.on("data", (chunk: Buffer) => startupOutput.append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => startupOutput.append("stderr", chunk));

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`T3 server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
  });

  try {
    const ready = Promise.all([
      waitForEnvironment(baseUrl),
      withTimeout(
        startupOutput.pairingToken,
        45_000,
        "Timed out waiting for T3 pairing token",
      ),
    ]);
    await Promise.race([ready, exited]);
  } catch (error) {
    await stopChildProcessVerified(child, { graceMs: 2_000, killWaitMs: 2_000 });
    throw error;
  }

  const pairingToken = await startupOutput.pairingToken;

  return {
    baseUrl,
    host,
    port,
    pairingToken,
    controlUpdate: (request) => requestHostUpdate(child, request),
    controlWorkspace: (action, root) => requestNativeWorkspaceControl(child, action, root),
    stop: () => stopChildProcessVerified(child, { graceMs: 2_000, killWaitMs: 2_000 }),
  };
}
