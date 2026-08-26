/**
 * NDJSON span writer for assistant-runtime traces.
 *
 * Writes completed spans as one JSON object per line under the Cozea
 * userdata logs path (see ServerConfig.serverTracePath).
 */
import { randomBytes } from "node:crypto";

import { RotatingFileSink } from "@cozea/assistant-shared/logging";

import { sanitizeTraceAttributes, type TraceAttributes } from "./Attributes.ts";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const FLUSH_BUFFER_THRESHOLD = 32;

export type SpanExitTag = "Success" | "Failure" | "Interrupted";

export interface SpanExit {
  readonly _tag: SpanExitTag;
  readonly cause?: string;
}

export interface NdjsonSpanRecord {
  readonly type: "cozea-span";
  readonly name: string;
  readonly kind: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly sampled: boolean;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly durationMs: number;
  readonly attributes: TraceAttributes;
  readonly events: ReadonlyArray<{
    readonly name: string;
    readonly timeUnixNano: string;
    readonly attributes: TraceAttributes;
  }>;
  readonly exit: SpanExit;
}

export interface NdjsonSpanWriterOptions {
  readonly filePath: string;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly onRecord?: (record: NdjsonSpanRecord) => void;
}

export interface ActiveSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTimeUnixNano: bigint;
  attribute(key: string, value: unknown): void;
  end(exit?: SpanExit): NdjsonSpanRecord;
}

export interface NdjsonSpanWriter {
  readonly filePath: string;
  readonly enabled: boolean;
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, unknown>>,
    options?: { readonly parentSpanId?: string; readonly traceId?: string; readonly kind?: string },
  ): ActiveSpan;
  writeRecord(record: NdjsonSpanRecord): void;
  serializeRecord(record: NdjsonSpanRecord): string;
  flush(): void;
  close(): void;
}

function hexId(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function nowUnixNano(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

export function createSpanRecord(input: {
  readonly name: string;
  readonly kind?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly startTimeUnixNano?: bigint;
  readonly endTimeUnixNano?: bigint;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly events?: NdjsonSpanRecord["events"];
  readonly exit?: SpanExit;
}): NdjsonSpanRecord {
  const start = input.startTimeUnixNano ?? nowUnixNano();
  const end = input.endTimeUnixNano ?? nowUnixNano();
  const durationMs = Number(end - start) / 1_000_000;
  return {
    type: "cozea-span",
    name: input.name,
    kind: input.kind ?? "internal",
    traceId: input.traceId ?? hexId(16),
    spanId: input.spanId ?? hexId(8),
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    sampled: true,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    durationMs,
    attributes: sanitizeTraceAttributes(input.attributes),
    events: (input.events ?? []).map((event) => ({
      name: event.name,
      timeUnixNano: event.timeUnixNano,
      attributes: sanitizeTraceAttributes(event.attributes),
    })),
    exit: input.exit ?? { _tag: "Success" },
  };
}

export function serializeSpanRecord(record: NdjsonSpanRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function createNdjsonSpanWriter(options: NdjsonSpanWriterOptions): NdjsonSpanWriter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const sink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes,
    maxFiles,
    throwOnError: false,
  });

  let buffer: string[] = [];

  const flushUnsafe = () => {
    if (buffer.length === 0) return;
    const chunk = buffer.join("");
    buffer = [];
    sink.write(chunk);
  };

  const writeRecord = (record: NdjsonSpanRecord) => {
    try {
      const line = serializeSpanRecord(record);
      buffer.push(line);
      options.onRecord?.(record);
      if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
        flushUnsafe();
      }
    } catch {
      // Best-effort: never throw into runtime paths.
    }
  };

  return {
    filePath: options.filePath,
    enabled: true,
    startSpan(name, attributes, spanOptions) {
      const startTimeUnixNano = nowUnixNano();
      const attrs = new Map<string, unknown>(Object.entries(attributes ?? {}));
      const traceId = spanOptions?.traceId ?? hexId(16);
      const spanId = hexId(8);
      const parentSpanId = spanOptions?.parentSpanId;
      const kind = spanOptions?.kind ?? "internal";

      return {
        name,
        traceId,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
        startTimeUnixNano,
        attribute(key, value) {
          attrs.set(key, value);
        },
        end(exit = { _tag: "Success" }) {
          const record = createSpanRecord({
            name,
            kind,
            traceId,
            spanId,
            parentSpanId,
            startTimeUnixNano,
            endTimeUnixNano: nowUnixNano(),
            attributes: Object.fromEntries(attrs),
            exit,
          });
          writeRecord(record);
          return record;
        },
      };
    },
    writeRecord,
    serializeRecord: serializeSpanRecord,
    flush() {
      flushUnsafe();
    },
    close() {
      flushUnsafe();
    },
  };
}

/** No-op writer used when `cozea.obs.ndjson` is off. */
export function createNoopNdjsonSpanWriter(): NdjsonSpanWriter {
  return {
    filePath: "",
    enabled: false,
    startSpan(name, _attributes, spanOptions) {
      const startTimeUnixNano = nowUnixNano();
      const traceId = spanOptions?.traceId ?? hexId(16);
      const spanId = hexId(8);
      return {
        name,
        traceId,
        spanId,
        ...(spanOptions?.parentSpanId ? { parentSpanId: spanOptions.parentSpanId } : {}),
        startTimeUnixNano,
        attribute() {},
        end(exit = { _tag: "Success" }) {
          return createSpanRecord({
            name,
            traceId,
            spanId,
            parentSpanId: spanOptions?.parentSpanId,
            startTimeUnixNano,
            exit,
          });
        },
      };
    },
    writeRecord() {},
    serializeRecord: serializeSpanRecord,
    flush() {},
    close() {},
  };
}
