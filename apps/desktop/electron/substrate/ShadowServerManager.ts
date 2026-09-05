import { requestHostUpdate, type HostUpdateRequest } from "../../../../shared/hostUpdateControl";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { waitForHttpReady } from "../backendReadiness";
import {
  SUBSTRATE_SHADOW_READY_PATH,
  SUBSTRATE_T3_PIN_SHA,
  DEFAULT_SUBSTRATE_SHADOW_READINESS_TIMEOUT_MS,
} from "./constants";
import {
  readSubstrateShadowServerFlags,
  type SubstrateShadowServerFlags,
} from "./flags";

export type ShadowServerPhase =
  | "stopped"
  | "starting"
  | "ready"
  | "error"
  | "stopping";

export interface ShadowServerStatus {
  readonly phase: ShadowServerPhase;
  readonly enabled: boolean;
  readonly flagId: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly readyPath: string;
  readonly pin: string;
  readonly pid: number | null;
  readonly lastError: string | null;
  readonly startedAtMs: number | null;
  readonly readyAtMs: number | null;
}

export interface ShadowServerManagerOptions {
  readonly entryPath: string;
  readonly logDirectory: string;
  readonly flags?: SubstrateShadowServerFlags;
  readonly readinessTimeoutMs?: number;
  readonly stopGraceMs?: number;
  readonly instanceId?: string;
  readonly t3BaseDir?: string;
  readonly forkImpl?: typeof fork;
  readonly waitForReady?: typeof waitForHttpReady;
  readonly now?: () => number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * DesktopBackendPool-shaped (lite) manager for the Phase 1 shadow substrate.
 * Spawns an out-of-process Node child, waits for HTTP readiness, tails logs,
 * and supports clean stop — without switching product chat UI.
 */
export class ShadowServerManager {
  private readonly entryPath: string;
  private readonly logDirectory: string;
  private readonly flags: SubstrateShadowServerFlags;
  private readonly readinessTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly instanceId: string;
  private readonly t3BaseDir: string | null;
  private readonly forkImpl: typeof fork;
  private readonly waitForReady: typeof waitForHttpReady;
  private readonly now: () => number;

  private child: ChildProcess | null = null;
  private phase: ShadowServerPhase = "stopped";
  private lastError: string | null = null;
  private startedAtMs: number | null = null;
  private readyAtMs: number | null = null;
  private startGeneration = 0;
  private logStream: fs.WriteStream | null = null;

  constructor(options: ShadowServerManagerOptions) {
    this.entryPath = options.entryPath;
    this.logDirectory = options.logDirectory;
    this.flags = options.flags ?? readSubstrateShadowServerFlags();
    this.instanceId = options.instanceId?.trim() || "primary";
    this.t3BaseDir = options.t3BaseDir?.trim() || null;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_SUBSTRATE_SHADOW_READINESS_TIMEOUT_MS;
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
    this.forkImpl = options.forkImpl ?? fork;
    this.waitForReady = options.waitForReady ?? waitForHttpReady;
    this.now = options.now ?? Date.now;
  }

  get baseUrl(): string {
    return `http://${this.flags.host}:${this.flags.port}`;
  }

  getStatus(): ShadowServerStatus {
    return {
      phase: this.phase,
      enabled: this.flags.enabled,
      flagId: this.flags.flagId,
      host: this.flags.host,
      port: this.flags.port,
      baseUrl: this.baseUrl,
      readyPath: SUBSTRATE_SHADOW_READY_PATH,
      pin: SUBSTRATE_T3_PIN_SHA,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      startedAtMs: this.startedAtMs,
      readyAtMs: this.readyAtMs,
    };
  }

  async controlUpdate(request: HostUpdateRequest): Promise<void> {
    if (!this.child || this.phase !== "ready") throw new Error("The chat server is not ready for an update.");
    await requestHostUpdate(this.child, request, 15_000);
  }

  async start(): Promise<ShadowServerStatus> {
    if (!this.flags.enabled) {
      this.phase = "stopped";
      this.lastError = null;
      return this.getStatus();
    }

    if (this.phase === "ready" && this.child && !this.child.killed) {
      return this.getStatus();
    }

    if (this.phase === "starting") {
      return this.getStatus();
    }

    this.startGeneration += 1;
    const generation = this.startGeneration;
    this.phase = "starting";
    this.lastError = null;
    this.startedAtMs = this.now();
    this.readyAtMs = null;

    if (!fs.existsSync(this.entryPath)) {
      this.phase = "error";
      this.lastError = `Shadow server entry not found: ${this.entryPath}`;
      throw new Error(this.lastError);
    }

    fs.mkdirSync(this.logDirectory, { recursive: true });
    this.logStream?.end();
    this.logStream = fs.createWriteStream(
      path.join(this.logDirectory, "substrate-shadow-server.manager.log"),
      { flags: "a" },
    );
    this.appendManagerLog(`starting generation=${generation} entry=${this.entryPath}`);

    const child = this.forkImpl(this.entryPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        COZEA_BACKEND_INSTANCE_ID: this.instanceId,
        COZEA_SUBSTRATE_SHADOW_HOST: this.flags.host,
        COZEA_SUBSTRATE_SHADOW_PORT: String(this.flags.port),
        COZEA_SUBSTRATE_SHADOW_LOG_DIR: this.logDirectory,
        COZEA_SUBSTRATE_T3_PIN: SUBSTRATE_T3_PIN_SHA,
        ...(this.t3BaseDir ? { COZEA_T3_SERVER_BASE_DIR: this.t3BaseDir } : {}),
        ...(process.env.COZEA_OBS_NDJSON_PATH
          ? { COZEA_OBS_NDJSON_PATH: process.env.COZEA_OBS_NDJSON_PATH }
          : {}),
      },
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.appendChildLog("stdout", chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.appendChildLog("stderr", chunk);
    });
    child.once("exit", (code, signal) => {
      if (generation !== this.startGeneration) {
        return;
      }
      const message = `shadow server exited code=${code ?? "null"} signal=${signal ?? "null"}`;
      this.appendManagerLog(message);
      this.child = null;
      if (this.phase !== "stopping" && this.phase !== "stopped") {
        this.phase = "error";
        this.lastError = message;
      } else {
        this.phase = "stopped";
      }
    });

    try {
      await this.waitForReady(this.baseUrl, {
        path: SUBSTRATE_SHADOW_READY_PATH,
        timeoutMs: this.readinessTimeoutMs,
      });
      if (generation !== this.startGeneration) {
        return this.getStatus();
      }
      this.phase = "ready";
      this.readyAtMs = this.now();
      this.appendManagerLog(`ready at ${this.baseUrl}${SUBSTRATE_SHADOW_READY_PATH}`);
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.phase = "error";
      this.appendManagerLog(`readiness failed: ${message}`);
      await this.stopChild(child);
      if (this.child === child) {
        this.child = null;
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async stop(): Promise<ShadowServerStatus> {
    this.startGeneration += 1;
    const child = this.child;
    this.phase = "stopping";
    await this.stopChild(child);
    this.child = null;
    this.phase = "stopped";
    this.readyAtMs = null;
    this.appendManagerLog("stopped");
    this.logStream?.end();
    this.logStream = null;
    return this.getStatus();
  }

  private async stopChild(child: ChildProcess | null): Promise<void> {
    if (!child || child.killed) {
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore repeated kill failures.
    }

    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    await Promise.race([exited, delay(this.stopGraceMs)]);

    if (!child.killed && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore force-kill failures.
      }
      await Promise.race([exited, delay(1_000)]);
    }
  }

  private appendManagerLog(line: string): void {
    const stamped = `${new Date(this.now()).toISOString()} [manager] ${line}\n`;
    try {
      this.logStream?.write(stamped);
    } catch {
      // Ignore log stream write failures.
    }
    console.info(`[SubstrateShadow] ${line}`);
  }

  private appendChildLog(stream: "stdout" | "stderr", chunk: Buffer | string): void {
    const text = chunk.toString();
    if (text.trim().length === 0) {
      return;
    }
    const stamped = `${new Date(this.now()).toISOString()} [${stream}] ${text}`;
    try {
      this.logStream?.write(stamped.endsWith("\n") ? stamped : `${stamped}\n`);
    } catch {
      // Ignore log stream write failures.
    }
    if (stream === "stderr") {
      console.error(`[SubstrateShadow:child] ${text.trim()}`);
    } else {
      console.info(`[SubstrateShadow:child] ${text.trim()}`);
    }
  }
}

let singleton: ShadowServerManager | null = null;

export function getShadowServerManager(): ShadowServerManager | null {
  return singleton;
}

export function createShadowServerManager(
  options: ShadowServerManagerOptions,
): ShadowServerManager {
  singleton = new ShadowServerManager(options);
  return singleton;
}

export function resolveShadowServerEntryPath(mainDirectory: string): string {
  return path.join(mainDirectory, "substrate-shadow-server.js");
}
