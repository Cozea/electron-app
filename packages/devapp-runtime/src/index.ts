import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface RuntimeEnvelope {
  channel: "host" | "view";
  connectionId?: string;
  message?: unknown;
  close?: boolean;
}

interface WorkerRuntimeTransport {
  onHostMessage(listener: (message: unknown) => void): () => void;
  onViewMessage(listener: (connectionId: string, message: unknown, close: boolean) => void): () => void;
  sendHost(message: unknown): void;
  sendView(connectionId: string, message: unknown): void;
}

const protocolWrite = process.stdout.write.bind(process.stdout);
// Package logging belongs on stderr. Stdout is the private helper protocol and cannot safely
// contain arbitrary application output.
process.stdout.write = ((chunk: Uint8Array | string) => process.stderr.write(chunk)) as typeof process.stdout.write;

function send(envelope: RuntimeEnvelope): void {
  const encoded = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
    throw new Error("The DevApp runtime message exceeds 2 MB.");
  }
  protocolWrite(encoded);
}

const hostListeners = new Set<(message: unknown) => void>();
const viewListeners = new Set<(connectionId: string, message: unknown, close: boolean) => void>();
const transport: WorkerRuntimeTransport = {
  onHostMessage: (listener) => {
    hostListeners.add(listener);
    return () => hostListeners.delete(listener);
  },
  onViewMessage: (listener) => {
    viewListeners.add(listener);
    return () => viewListeners.delete(listener);
  },
  sendHost: (message) => send({ channel: "host", message }),
  sendView: (connectionId, message) => send({ channel: "view", connectionId, message }),
};
(globalThis as typeof globalThis & { __cozeaDevAppWorkerTransport?: WorkerRuntimeTransport })
  .__cozeaDevAppWorkerTransport = transport;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024 && !input.includes("\n")) {
    throw new Error("The DevApp runtime input exceeds 2 MB.");
  }
  let newline = input.indexOf("\n");
  while (newline >= 0) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (line.trim()) {
      const envelope = JSON.parse(line) as RuntimeEnvelope;
      if (envelope.channel === "host") {
        for (const listener of hostListeners) listener(envelope.message);
      } else if (
        envelope.channel === "view" &&
        typeof envelope.connectionId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(envelope.connectionId)
      ) {
        for (const listener of viewListeners) {
          listener(envelope.connectionId, envelope.message, envelope.close === true);
        }
      }
    }
    newline = input.indexOf("\n");
  }
});

function packageEntry(packageRoot: string, relative: unknown, label: string): string | null {
  if (relative === undefined) return null;
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  const candidate = path.resolve(packageRoot, relative);
  if (candidate !== packageRoot && !candidate.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the immutable package.`);
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`${label} is missing from the immutable package.`);
  }
  return candidate;
}

async function main(): Promise<void> {
  const packageRoot = "/cozea/package";
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "cozea-devapp.json"), "utf8"),
  ) as {
    worker?: { entry?: unknown };
    service?: { runtimeKind?: unknown; entry?: unknown };
  };
  const worker = packageEntry(packageRoot, manifest.worker?.entry, "worker.entry");
  const service = manifest.service?.runtimeKind === "node"
    ? packageEntry(packageRoot, manifest.service.entry, "service.entry")
    : null;
  if (worker) await import(pathToFileURL(worker).href);
  if (service) await import(pathToFileURL(service).href);
  send({
    channel: "host",
    message: { kind: "event", protocolVersion: 1, topic: "runtime.ready", payload: null },
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
