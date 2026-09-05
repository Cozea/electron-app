import { describe, expect, it } from "vitest"
import { binaryReviewHash, isSharedTextBytes } from "../../apps/desktop/electron/collaboration/binaryReview"
import { parsePreparedNumstat } from "../../shared/collaborationCommitReview"

describe("prepared commit review identities", () => {
  it("preserves literal commas, tabs and newlines in Git's NUL-delimited paths", () => {
    expect(parsePreparedNumstat("2\t1\tsrc/a,b\tfile\n.ts\0-\t-\timage.bin\0")).toEqual([
      { path: "src/a,b\tfile\n.ts", binary: false, additions: 2, deletions: 1 },
      { path: "image.bin", binary: true, additions: null, deletions: null },
    ])
  })
  it("rejects incomplete summaries, unsafe paths and duplicate entries", () => {
    for (const value of ["1\t0\tfile", "1\t-\tfile\0", "1\t0\t../private\0", "1\t0\tfile\0".repeat(2)]) expect(() => parsePreparedNumstat(value)).toThrow()
  })
  it("binds exact binary bytes, executable bit and deletion state independently", () => {
    const bytes = new Uint8Array([0, 255, 2])
    expect(binaryReviewHash(bytes, false)).toBe(binaryReviewHash(bytes.slice(), false))
    expect(new Set([binaryReviewHash(bytes, false), binaryReviewHash(bytes, true), binaryReviewHash(new Uint8Array([0, 255, 3]), false), binaryReviewHash(new Uint8Array(), false), binaryReviewHash(null, false)]).size).toBe(5)
  })
  it("classifies invalid UTF-8, NUL and oversized files as Git-only", () => {
    expect(isSharedTextBytes(new TextEncoder().encode("hello π"))).toBe(true)
    expect(isSharedTextBytes(new Uint8Array([255]))).toBe(false)
    expect(isSharedTextBytes(new Uint8Array([0]))).toBe(false)
    expect(isSharedTextBytes(new Uint8Array(2 * 1024 * 1024 + 1).fill(65))).toBe(false)
  })
})
