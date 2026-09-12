const MIB = 1024 * 1024

/** Hard v1 collaboration ceilings from the authoritative master plan. */
export const COLLABORATION_LIMITS = Object.freeze({
  maxCheckpointPaths: 10_000,
  maxProjectPathBytes: 1_024,
  maxSymlinkTargetBytes: 4_096,
  maxInlineTextBytes: 10 * MIB,
  largeBinaryThresholdBytes: 50 * MIB,
  maxInlineBatchBytes: 100 * MIB,
  maxConflictRecords: 1_000,
  maxPreviewBytes: 2 * MIB,
  maxPreviewLines: 10_000,
})

export type CollaborationLimitCode =
  | "CHECKPOINT_PATH_LIMIT"
  | "PROJECT_PATH_LIMIT"
  | "SYMLINK_TARGET_LIMIT"
  | "INLINE_TEXT_LIMIT"
  | "INLINE_BATCH_LIMIT"
  | "CONFLICT_LIMIT"
  | "PREVIEW_LIMIT"

export class CollaborationLimitError extends Error {
  constructor(
    readonly code: CollaborationLimitCode,
    message: string,
    readonly actual: number,
    readonly limit: number,
  ) {
    super(message)
    this.name = "CollaborationLimitError"
  }
}

export function assertCheckpointPathCount(count: number): void {
  const limit = COLLABORATION_LIMITS.maxCheckpointPaths
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Checkpoint path count must be a non-negative integer")
  if (count > limit) {
    throw new CollaborationLimitError(
      "CHECKPOINT_PATH_LIMIT",
      `This checkpoint contains ${count} paths; collaboration v1 supports at most ${limit} paths per checkpoint.`,
      count,
      limit,
    )
  }
}

export function assertProjectPathSize(projectPath: string): void {
  const actual = Buffer.byteLength(projectPath, "utf8")
  const limit = COLLABORATION_LIMITS.maxProjectPathBytes
  if (actual > limit) {
    throw new CollaborationLimitError(
      "PROJECT_PATH_LIMIT",
      `Project path is ${actual} UTF-8 bytes; collaboration v1 supports at most ${limit}.`,
      actual,
      limit,
    )
  }
}

export function assertSymlinkTargetSize(target: string): void {
  const actual = Buffer.byteLength(target, "utf8")
  const limit = COLLABORATION_LIMITS.maxSymlinkTargetBytes
  if (actual > limit) {
    throw new CollaborationLimitError(
      "SYMLINK_TARGET_LIMIT",
      `Symlink target is ${actual} UTF-8 bytes; collaboration v1 supports at most ${limit}.`,
      actual,
      limit,
    )
  }
}

export function assertInlineTextSize(text: string): void {
  const actual = Buffer.byteLength(text, "utf8")
  const limit = COLLABORATION_LIMITS.maxInlineTextBytes
  if (actual > limit) {
    throw new CollaborationLimitError(
      "INLINE_TEXT_LIMIT",
      `Text file is ${actual} UTF-8 bytes; files above ${limit} bytes must not be carried inline.`,
      actual,
      limit,
    )
  }
}

export function usesLargeBinaryPath(size: number): boolean {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Binary size must be a non-negative integer")
  return size > COLLABORATION_LIMITS.largeBinaryThresholdBytes
}

/**
 * Lazily groups an iterable into byte-bounded segments. The source does not need to
 * be an array, so callers can stream high-cardinality session state without first
 * materializing the whole transfer batch. A single item larger than the budget is
 * rejected rather than silently producing an oversized segment.
 */
export function* segmentByByteBudget<T>(
  source: Iterable<T>,
  sizeOf: (item: T) => number,
  maxBytes = COLLABORATION_LIMITS.maxInlineBatchBytes,
): Generator<readonly T[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Segment byte budget must be a positive integer")
  let segment: T[] = []
  let segmentBytes = 0

  for (const item of source) {
    const size = sizeOf(item)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Segment item size must be a non-negative integer")
    if (size > maxBytes) {
      throw new CollaborationLimitError(
        "INLINE_BATCH_LIMIT",
        `One inline transfer item is ${size} bytes; the segment budget is ${maxBytes} bytes.`,
        size,
        maxBytes,
      )
    }
    if (segment.length > 0 && segmentBytes + size > maxBytes) {
      yield segment
      segment = []
      segmentBytes = 0
    }
    segment.push(item)
    segmentBytes += size
  }

  if (segment.length > 0) yield segment
}

export function assertConflictCount(count: number): void {
  const limit = COLLABORATION_LIMITS.maxConflictRecords
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Conflict count must be a non-negative integer")
  if (count > limit) {
    throw new CollaborationLimitError(
      "CONFLICT_LIMIT",
      `Conflict review contains ${count} records; collaboration v1 supports at most ${limit} at once.`,
      count,
      limit,
    )
  }
}

export function assertPreviewBudget(bytes: number, lines: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(lines) || lines < 0) {
    throw new Error("Preview size and line count must be non-negative integers")
  }
  const byteLimit = COLLABORATION_LIMITS.maxPreviewBytes
  const lineLimit = COLLABORATION_LIMITS.maxPreviewLines
  if (bytes > byteLimit || lines > lineLimit) {
    throw new CollaborationLimitError(
      "PREVIEW_LIMIT",
      `Preview is ${bytes} bytes / ${lines} lines; limits are ${byteLimit} bytes / ${lineLimit} lines.`,
      Math.max(bytes, lines),
      bytes > byteLimit ? byteLimit : lineLimit,
    )
  }
}
