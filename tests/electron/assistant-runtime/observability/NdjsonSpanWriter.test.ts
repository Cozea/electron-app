import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createNdjsonSpanWriter,
  createSpanRecord,
  serializeSpanRecord,
} from "../../../../electron/assistant-runtime/observability/NdjsonSpanWriter.ts";
import {
  isSecretAttributeKey,
  sanitizeTraceAttributes,
  serializedLineLooksSecretFree,
} from "../../../../electron/assistant-runtime/observability/Attributes.ts";
import { readObservabilityFlags } from "../../../../electron/assistant-runtime/observability/flags.ts";
import { spanRecordToOtlpJson } from "../../../../electron/assistant-runtime/observability/OtlpExport.ts";

describe("observability NDJSON writer serialization", () => {
  it("defaults cozea.obs.ndjson to off", () => {
    const flags = readObservabilityFlags({});
    expect(flags.ndjsonEnabled).toBe(false);
    expect(flags.otlpTracesUrl).toBeUndefined();
  });

  it("enables NDJSON via COZEA_OBS_NDJSON", () => {
    expect(readObservabilityFlags({ COZEA_OBS_NDJSON: "1" }).ndjsonEnabled).toBe(true);
    expect(readObservabilityFlags({ COZEA_OBS_NDJSON: "true" }).ndjsonEnabled).toBe(true);
    expect(readObservabilityFlags({ COZEA_OBS_NDJSON: "off" }).ndjsonEnabled).toBe(false);
  });

  it("serializes a readable single-line NDJSON span record", () => {
    const record = createSpanRecord({
      name: "turn.start",
      attributes: {
        threadId: "thread-1",
        provider: "codex",
      },
      exit: { _tag: "Success" },
    });
    const line = serializeSpanRecord(record).trimEnd();
    expect(line.includes("\n")).toBe(false);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.type).toBe("cozea-span");
    expect(parsed.name).toBe("turn.start");
    expect(parsed.attributes).toEqual({
      threadId: "thread-1",
      provider: "codex",
    });
    expect(typeof parsed.durationMs).toBe("number");
    expect(typeof parsed.traceId).toBe("string");
    expect(typeof parsed.spanId).toBe("string");
  });

  it("redacts secrets from attributes and serialized lines", () => {
    expect(isSecretAttributeKey("apiKey")).toBe(true);
    expect(isSecretAttributeKey("authorization")).toBe(true);
    expect(isSecretAttributeKey("threadId")).toBe(false);

    const sanitized = sanitizeTraceAttributes({
      threadId: "thread-1",
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz012345",
      nested: {
        password: "hunter2",
        model: "gpt-test",
      },
      authorization: "Bearer super-secret-token-value",
      token: "raw-token-value",
    });

    expect(sanitized.apiKey).toBe("[redacted]");
    expect(sanitized.authorization).toBe("[redacted]");
    expect(sanitized.token).toBe("[redacted]");
    expect(sanitized.nested).toEqual({
      password: "[redacted]",
      model: "gpt-test",
    });

    const line = serializeSpanRecord(
      createSpanRecord({
        name: "provider.call.provider.sendTurn",
        attributes: {
          apiKey: "sk-abcdefghijklmnopqrstuvwxyz012345",
          password: "hunter2",
          authorization: "Bearer leaked",
          provider: "codex",
        },
      }),
    );
    expect(serializedLineLooksSecretFree(line)).toBe(true);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(line).not.toContain("Bearer leaked");
    expect(line).toContain("[redacted]");
  });

  it("writes NDJSON lines to the configured userdata log path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-obs-"));
    const filePath = path.join(dir, "server.trace.ndjson");
    try {
      const writer = createNdjsonSpanWriter({ filePath });
      const span = writer.startSpan("turn.end", {
        threadId: "t1",
        outcome: "completed",
        apiKey: "should-not-appear",
      });
      span.end({ _tag: "Success" });
      writer.flush();
      writer.close();

      const contents = fs.readFileSync(filePath, "utf8").trim();
      expect(contents.length).toBeGreaterThan(0);
      const line = contents.split("\n")[0]!;
      const parsed = JSON.parse(line) as {
        name: string;
        attributes: Record<string, unknown>;
      };
      expect(parsed.name).toBe("turn.end");
      expect(parsed.attributes.apiKey).toBe("[redacted]");
      expect(parsed.attributes.threadId).toBe("t1");
      expect(serializedLineLooksSecretFree(line)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds OTLP JSON without requiring a live collector", () => {
    const record = createSpanRecord({
      name: "git.status",
      attributes: { cwd: "/tmp/project", token: "nope" },
    });
    const body = spanRecordToOtlpJson([record], "cozea-assistant-runtime");
    const parsed = JSON.parse(body) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ name: string; attributes: unknown[] }> }>;
      }>;
    };
    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe("git.status");
    expect(body).toContain("[redacted]");
    expect(body).not.toContain("nope");
  });
});
