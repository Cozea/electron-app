/**
 * Trace attribute helpers: compact JSON values, truncate oversized strings,
 * and redact secret-looking keys so NDJSON / OTLP traces stay safe to inspect.
 */

export type TraceAttributes = Readonly<Record<string, unknown>>;

const TRACE_ATTRIBUTE_MAX_LENGTH = 500;
const TRACE_ATTRIBUTE_TRUNCATION_SUFFIX = "…[truncated]";
const REDACTED = "[redacted]";

const SECRET_KEY_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|authorization|auth|cookie|credential|private[_-]?key|access[_-]?key|session[_-]?id|bearer)/i;

export function isSecretAttributeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
    };
  }
  if (depth >= 4) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => normalizeJsonValue(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      next[key] = isSecretAttributeKey(key) ? REDACTED : normalizeJsonValue(entry, depth + 1);
    }
    return next;
  }
  return String(value);
}

function truncateNestedValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length <= TRACE_ATTRIBUTE_MAX_LENGTH
      ? value
      : `${value.slice(0, TRACE_ATTRIBUTE_MAX_LENGTH)}${TRACE_ATTRIBUTE_TRUNCATION_SUFFIX}`;
  }
  if (Array.isArray(value)) {
    const truncated = value.map(truncateNestedValue);
    return truncated.some((entry, index) => entry !== value[index]) ? truncated : value;
  }
  if (isPlainObject(value)) {
    let truncated: Record<string, unknown> | undefined;
    for (const [key, entry] of Object.entries(value)) {
      const next = truncateNestedValue(entry);
      if (next === entry) continue;
      truncated ??= { ...value };
      truncated[key] = next;
    }
    return truncated ?? value;
  }
  return value;
}

/**
 * Drop undefined, redact secret keys, and normalize values for JSON sinks.
 */
export function sanitizeTraceAttributes(
  attributes: Readonly<Record<string, unknown>> | undefined,
): TraceAttributes {
  if (!attributes) return {};
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (isSecretAttributeKey(key)) {
      entries.push([key, REDACTED]);
      continue;
    }
    entries.push([key, truncateNestedValue(normalizeJsonValue(value))]);
  }
  return Object.fromEntries(entries);
}

/**
 * Returns true when a serialized NDJSON line appears to leak a raw secret value
 * (used by tests; not a perfect detector).
 */
export function serializedLineLooksSecretFree(line: string): boolean {
  if (/"\[redacted\]"/.test(line) === false && SECRET_KEY_PATTERN.test(line)) {
    // Key name may appear; ensure no obvious bearer/password payloads remain.
  }
  const forbidden = [
    /sk-[A-Za-z0-9]{20,}/,
    /Bearer\s+[A-Za-z0-9._\-]+/i,
    /"password"\s*:\s*"(?!\[redacted\])[^"]+"/i,
    /"apiKey"\s*:\s*"(?!\[redacted\])[^"]+"/i,
    /"token"\s*:\s*"(?!\[redacted\])[^"]+"/i,
    /"authorization"\s*:\s*"(?!\[redacted\])[^"]+"/i,
  ];
  return !forbidden.some((pattern) => pattern.test(line));
}
