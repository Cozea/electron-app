import { describe, expect, it } from "vitest"

import {
  COLLABORATION_LIMITS,
  CollaborationLimitError,
  assertCheckpointPathCount,
  assertInlineTextSize,
  assertProjectPathSize,
  assertSymlinkTargetSize,
  segmentByByteBudget,
  usesLargeBinaryPath,
} from "../../apps/projectd/src/collaboration/CollaborationLimits"

describe("collaboration v1 limits", () => {
  it("measures paths and symlink targets in UTF-8 bytes", () => {
    assertProjectPathSize("a".repeat(COLLABORATION_LIMITS.maxProjectPathBytes))
    expect(() => assertProjectPathSize("é".repeat(COLLABORATION_LIMITS.maxProjectPathBytes))).toThrow(CollaborationLimitError)

    assertSymlinkTargetSize("a".repeat(COLLABORATION_LIMITS.maxSymlinkTargetBytes))
    expect(() => assertSymlinkTargetSize("界".repeat(1_366))).toThrow(CollaborationLimitError)
  })

  it("enforces the checkpoint path and inline-text ceilings at the boundary", () => {
    assertCheckpointPathCount(COLLABORATION_LIMITS.maxCheckpointPaths)
    expect(() => assertCheckpointPathCount(COLLABORATION_LIMITS.maxCheckpointPaths + 1)).toThrowObject({
      code: "CHECKPOINT_PATH_LIMIT",
    })

    assertInlineTextSize("a".repeat(COLLABORATION_LIMITS.maxInlineTextBytes))
    expect(() => assertInlineTextSize("a".repeat(COLLABORATION_LIMITS.maxInlineTextBytes + 1))).toThrowObject({
      code: "INLINE_TEXT_LIMIT",
    })
  })

  it("routes binaries above 50 MiB to the large-file path", () => {
    expect(usesLargeBinaryPath(COLLABORATION_LIMITS.largeBinaryThresholdBytes)).toBe(false)
    expect(usesLargeBinaryPath(COLLABORATION_LIMITS.largeBinaryThresholdBytes + 1)).toBe(true)
  })

  it("segments high-cardinality transfers without exceeding a byte budget", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({ index, bytes: index % 3 === 0 ? 7 : 3 }))
    const segments = [...segmentByByteBudget(items, (item) => item.bytes, 101)]
    expect(segments.flat()).toEqual(items)
    for (const segment of segments) {
      expect(segment.reduce((sum, item) => sum + item.bytes, 0)).toBeLessThanOrEqual(101)
    }
    expect(segments.length).toBeGreaterThan(1)
  })

  it("rejects an individual inline item larger than its segment budget", () => {
    expect(() => [...segmentByByteBudget([{ bytes: 102 }], (item) => item.bytes, 101)]).toThrowObject({
      code: "INLINE_BATCH_LIMIT",
    })
  })
})
