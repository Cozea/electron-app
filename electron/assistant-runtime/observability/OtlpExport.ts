/**
 * Optional OTLP/JSON export for completed spans.
 *
 * Best-effort only: failures are swallowed. Never required for CI — leave
 * `COZEA_OTLP_TRACES_URL` unset and no network calls are made.
 */
import type { NdjsonSpanRecord } from "./NdjsonSpanWriter.ts";

export interface OtlpExportOptions {
  readonly url: string;
  readonly serviceName: string;
  readonly exportIntervalMs: number;
}

interface OtlpExporter {
  push(record: NdjsonSpanRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

function toUnixNanoString(value: string): string {
  return value;
}

function attributesToOtlp(attributes: Readonly<Record<string, unknown>>) {
  return Object.entries(attributes).map(([key, value]) => {
    if (typeof value === "string") {
      return { key, value: { stringValue: value } };
    }
    if (typeof value === "boolean") {
      return { key, value: { boolValue: value } };
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (Number.isInteger(value)) {
        return { key, value: { intValue: String(value) } };
      }
      return { key, value: { doubleValue: value } };
    }
    return { key, value: { stringValue: JSON.stringify(value) } };
  });
}

function statusFromExit(exit: NdjsonSpanRecord["exit"]): {
  code: number;
  message?: string;
} {
  if (exit._tag === "Success") {
    return { code: 1 }; // STATUS_CODE_OK
  }
  return {
    code: 2, // STATUS_CODE_ERROR
    ...(exit.cause ? { message: exit.cause.slice(0, 500) } : {}),
  };
}

export function spanRecordToOtlpJson(
  records: ReadonlyArray<NdjsonSpanRecord>,
  serviceName: string,
): string {
  const spans = records.map((record) => ({
    traceId: record.traceId,
    spanId: record.spanId,
    ...(record.parentSpanId ? { parentSpanId: record.parentSpanId } : {}),
    name: record.name,
    kind: 1,
    startTimeUnixNano: toUnixNanoString(record.startTimeUnixNano),
    endTimeUnixNano: toUnixNanoString(record.endTimeUnixNano),
    attributes: attributesToOtlp(record.attributes),
    events: record.events.map((event) => ({
      timeUnixNano: event.timeUnixNano,
      name: event.name,
      attributes: attributesToOtlp(event.attributes),
    })),
    status: statusFromExit(record.exit),
  }));

  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "service.runtime", value: { stringValue: "cozea-assistant-runtime" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "cozea.obs.ndjson" },
            spans,
          },
        ],
      },
    ],
  });
}

export function createOtlpExporter(options: OtlpExportOptions): OtlpExporter {
  let buffer: NdjsonSpanRecord[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const flush = async () => {
    if (buffer.length === 0 || closed) return;
    const batch = buffer;
    buffer = [];
    try {
      const body = spanRecordToOtlpJson(batch, options.serviceName);
      await fetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body,
      });
    } catch {
      // Best-effort: drop failed batches rather than blocking the runtime.
    }
  };

  timer = setInterval(() => {
    void flush();
  }, options.exportIntervalMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  return {
    push(record) {
      if (closed) return;
      buffer.push(record);
      if (buffer.length >= 64) {
        void flush();
      }
    },
    flush,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await flush();
    },
  };
}
