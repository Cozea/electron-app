/**
 * Coercions for reading an orchestration activity payload.
 *
 * A payload is `unknown` by contract — it crosses a process boundary and its
 * shape depends on which provider produced it — so every read of one starts by
 * narrowing. These three do that narrowing in the one way the work-log
 * derivation expects: a blank string is absent, a non-finite number is absent,
 * and anything object-shaped is a record to look inside.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}