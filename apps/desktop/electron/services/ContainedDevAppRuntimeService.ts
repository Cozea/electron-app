import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import {
  DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT,
  DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS,
  DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
  isDigestPinnedImageReference,
  isSha256Digest,
  validateRuntimePlacement,
  type DevAppContainedRuntimeAvailability,
  type DevAppContainedRuntimeStartRequest,
  type DevAppContainedRuntimeState,
  type DevAppContainerHelperEvent,
  type DevAppContainerHelperRequest,
  type DevAppContainerHelperResponse,
  type DevAppRuntimeIdentity,
  type DevAppRuntimeImage,
} from "../../../../shared/devAppContainedRuntime";

const MAX_PROTOCOL_LINE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const START_REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface ContainedRuntimeHelperProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface DevAppRuntimeImageVerifier {
  /**
   * Verifies the registry signature and build attestation against Cozea's trusted
   * publisher/builder roots. Success is launch authority; absence is a hard failure.
   */
  verify(image: DevAppRuntimeImage, identity: DevAppRuntimeIdentity): Promise<void>;
}

export interface DeviceContainedRuntimePaths {
  helperPath: string;
  rootPath: string;
  kernelPath: string;
  initfsReference: string;
}

export interface ContainedRuntimeServiceOptions {
  paths: () => DeviceContainedRuntimePaths;
  imageVerifier: DevAppRuntimeImageVerifier;
  spawnHelper?: (executable: string, args: string[]) => ContainedRuntimeHelperProcess;
  now?: () => number;
}

interface PendingRequest {
  resolve: (response: DevAppContainerHelperResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ContainedRuntimeLogEvent {
  runtimeId: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface ContainedRuntimeStateEvent {
  runtimeId: string;
  state: DevAppContainedRuntimeState;
}

export type ContainedRuntimeListener =
  | ((event: ContainedRuntimeLogEvent) => void)
  | ((event: ContainedRuntimeStateEvent) => void);

function spawnHelperProcess(executable: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
    },
  });
}

function assertSafeAbsolutePath(value: string, label: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved !== value || value.includes("\0")) {
    throw new Error(`${label} must be a canonical absolute path.`);
  }
  return resolved;
}

function assertRuntimeId(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error("The contained runtime ID is invalid.");
  }
}

function validateStartRequest(request: DevAppContainedRuntimeStartRequest, now: number): void {
  assertRuntimeId(request.runtimeId);
  const placementError = validateRuntimePlacement(request.location, request.state);
  if (placementError) throw new Error(placementError);
  if (request.location !== "device") {
    throw new Error("The device adapter accepts only device runtimes.");
  }
  if (!isDigestPinnedImageReference(request.image.reference)) {
    throw new Error("A contained runtime image must use an exact OCI digest reference.");
  }
  if (
    !isSha256Digest(request.image.manifestDigest) ||
    !isSha256Digest(request.image.platformDigest)
  ) {
    throw new Error("The contained runtime image digests are invalid.");
  }
  if (request.image.platform !== "linux/arm64") {
    throw new Error("The macOS device runtime requires a Linux ARM64 image.");
  }
  if (request.command.length === 0 || request.command.length > 64) {
    throw new Error("The contained runtime command is invalid.");
  }
  if (Object.keys(request.environment).length > DEV_APP_CONTAINED_RUNTIME_MAX_ENVIRONMENT) {
    throw new Error("The contained runtime environment is too large.");
  }
  if (request.folderGrants.length > DEV_APP_CONTAINED_RUNTIME_MAX_MOUNTS) {
    throw new Error("The contained runtime has too many folder grants.");
  }
  for (const grant of request.folderGrants) {
    if (
      grant.publicationId !== request.identity.publicationId ||
      grant.releaseId !== request.identity.releaseId ||
      grant.expiresAt <= now
    ) {
      throw new Error("A contained runtime folder grant is expired or belongs to another release.");
    }
    assertSafeAbsolutePath(grant.canonicalHostPath, "A contained runtime folder grant");
    if (!grant.guestPath.startsWith("/cozea/grants/")) {
      throw new Error("A contained runtime folder grant has an invalid guest path.");
    }
  }
}

function isResponse(value: unknown): value is DevAppContainerHelperResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<DevAppContainerHelperResponse>;
  return (
    response.protocolVersion === DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION &&
    typeof response.requestId === "string" &&
    typeof response.success === "boolean"
  );
}

function isEvent(value: unknown): value is DevAppContainerHelperEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<DevAppContainerHelperEvent>;
  return (
    event.protocolVersion === DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION &&
    (event.event === "log" || event.event === "state") &&
    typeof event.runtimeId === "string"
  );
}

/**
 * Electron-side supervisor for Cozea's signed Apple Containerization helper.
 *
 * This object is main-process-only. Renderers can reach contained workloads only through
 * the existing capability brokers and authenticated service gateway; the helper protocol
 * itself is intentionally never registered as IPC or exposed by preload.
 */
export class DeviceContainedDevAppRuntimeService {
  private readonly options: ContainedRuntimeServiceOptions;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, PendingRequest>();
  private child: ContainedRuntimeHelperProcess | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private disposed = false;

  constructor(options: ContainedRuntimeServiceOptions) {
    this.options = options;
  }

  on(event: "log", listener: (event: ContainedRuntimeLogEvent) => void): () => void;
  on(event: "state", listener: (event: ContainedRuntimeStateEvent) => void): () => void;
  on(event: "log" | "state", listener: ContainedRuntimeListener): () => void {
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  async availability(): Promise<DevAppContainedRuntimeAvailability> {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return {
        available: false,
        adapter: "unavailable",
        protocolVersion: DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
        reason:
          "The device contained runtime currently requires Apple silicon and macOS 26 or newer.",
      };
    }
    const paths = this.validatePaths(false);
    if (!fs.existsSync(paths.helperPath) || !fs.existsSync(paths.kernelPath)) {
      return {
        available: false,
        adapter: "unavailable",
        protocolVersion: DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
        reason: "The signed DevApp container runtime resources are missing.",
      };
    }
    const response = await this.send({ task: "status" });
    if (!response.availability)
      throw new Error("The DevApp container helper returned no availability state.");
    return response.availability;
  }

  async start(request: DevAppContainedRuntimeStartRequest): Promise<DevAppContainedRuntimeState> {
    validateStartRequest(request, (this.options.now ?? Date.now)());
    await this.options.imageVerifier.verify(request.image, request.identity);
    const response = await this.send({ task: "start", start: request }, START_REQUEST_TIMEOUT_MS);
    if (!response.state) throw new Error("The DevApp container helper returned no runtime state.");
    return response.state;
  }

  async inspect(runtimeId: string): Promise<DevAppContainedRuntimeState | null> {
    assertRuntimeId(runtimeId);
    const response = await this.send({ task: "inspect", runtimeId });
    return response.state ?? null;
  }

  async stop(runtimeId: string): Promise<DevAppContainedRuntimeState> {
    assertRuntimeId(runtimeId);
    const response = await this.send({ task: "stop", runtimeId });
    if (!response.state) throw new Error("The DevApp container helper returned no runtime state.");
    return response.state;
  }

  async delete(runtimeId: string): Promise<DevAppContainedRuntimeState | null> {
    assertRuntimeId(runtimeId);
    const response = await this.send({ task: "delete", runtimeId });
    return response.state ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    this.child = null;
    child?.kill("SIGTERM");
    this.rejectPending(new Error("The DevApp contained runtime service stopped."));
    this.events.removeAllListeners();
  }

  private validatePaths(requireExisting = true): DeviceContainedRuntimePaths {
    const raw = this.options.paths();
    const paths = {
      helperPath: assertSafeAbsolutePath(raw.helperPath, "The DevApp runtime helper path"),
      rootPath: assertSafeAbsolutePath(raw.rootPath, "The DevApp runtime root path"),
      kernelPath: assertSafeAbsolutePath(raw.kernelPath, "The DevApp runtime kernel path"),
      initfsReference: raw.initfsReference.trim(),
    };
    if (!isDigestPinnedImageReference(paths.initfsReference)) {
      throw new Error("The DevApp runtime init filesystem must use an exact OCI digest reference.");
    }
    if (requireExisting && (!fs.existsSync(paths.helperPath) || !fs.existsSync(paths.kernelPath))) {
      throw new Error("The signed DevApp container runtime resources are missing.");
    }
    return paths;
  }

  private ensureChild(): ContainedRuntimeHelperProcess {
    if (this.disposed) throw new Error("The DevApp contained runtime service is disposed.");
    if (this.child && this.child.exitCode === null) return this.child;
    const paths = this.validatePaths();
    fs.mkdirSync(paths.rootPath, { recursive: true, mode: 0o700 });
    const child: ContainedRuntimeHelperProcess = (this.options.spawnHelper ?? spawnHelperProcess)(
      paths.helperPath,
      ["--root", paths.rootPath, "--kernel", paths.kernelPath, "--initfs", paths.initfsReference],
    );
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string | Buffer) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", (chunk: string | Buffer) => this.consumeStderr(String(chunk)));
    child.once("error", (error: Error) => this.handleChildExit(error));
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleChildExit(
        new Error(`The DevApp container helper exited (${code ?? signal ?? "unknown"}).`),
      );
    });
    return child;
  }

  private async send(
    partial: Omit<DevAppContainerHelperRequest, "protocolVersion" | "requestId">,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<DevAppContainerHelperResponse> {
    const child = this.ensureChild();
    const request: DevAppContainerHelperRequest = {
      protocolVersion: DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
      requestId: randomUUID(),
      ...partial,
    };
    const encoded = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(encoded) > MAX_PROTOCOL_LINE_BYTES) {
      throw new Error("The DevApp contained runtime request is too large.");
    }
    return await new Promise<DevAppContainerHelperResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new Error(`The DevApp container helper timed out while handling ${request.task}.`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(request.requestId, { resolve, reject, timer });
      child.stdin.write(encoded, (error?: Error | null) => {
        if (!error) return;
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        this.pending.delete(request.requestId);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (
      Buffer.byteLength(this.stdoutBuffer) > MAX_PROTOCOL_LINE_BYTES &&
      !this.stdoutBuffer.includes("\n")
    ) {
      this.failProtocol("The DevApp container helper emitted an oversized protocol line.");
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) {
        this.failProtocol("The DevApp container helper emitted an oversized protocol line.");
        return;
      }
      if (line.trim()) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeStderr(chunk: string): void {
    this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-64 * 1024);
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.failProtocol("The DevApp container helper emitted malformed JSON.");
      return;
    }
    if (isResponse(value)) {
      const pending = this.pending.get(value.requestId);
      if (!pending) return;
      this.pending.delete(value.requestId);
      clearTimeout(pending.timer);
      if (!value.success)
        pending.reject(
          new Error(value.error || "The DevApp container helper rejected the request."),
        );
      else pending.resolve(value);
      return;
    }
    if (isEvent(value)) {
      if (value.event === "log" && value.stream && typeof value.message === "string") {
        this.events.emit("log", {
          runtimeId: value.runtimeId,
          stream: value.stream,
          message: value.message.slice(0, 64 * 1024),
        } satisfies ContainedRuntimeLogEvent);
      } else if (value.event === "state" && value.state) {
        this.events.emit("state", {
          runtimeId: value.runtimeId,
          state: value.state,
        } satisfies ContainedRuntimeStateEvent);
      }
      return;
    }
    this.failProtocol("The DevApp container helper emitted an invalid protocol message.");
  }

  private failProtocol(message: string): void {
    const detail = this.stderrBuffer.trim();
    const error = new Error(detail ? `${message} ${detail.slice(-2048)}` : message);
    const child = this.child;
    this.child = null;
    child?.kill("SIGKILL");
    this.rejectPending(error);
  }

  private handleChildExit(error: Error): void {
    this.child = null;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
