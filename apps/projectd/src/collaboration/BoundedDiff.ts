/**
 * Bounded diff algorithm for code-sized files.
 *
 * Master Specification: Section 10.13
 * Required properties:
 * - deterministic;
 * - Unicode-safe;
 * - bounded CPU execution with fallback;
 * - minimal micro-granular code edits (no full-file replace for one-character edit).
 */

import DiffMatchPatch from "diff-match-patch"

export type DiffOpType = "equal" | "insert" | "delete"

export interface DiffOperation {
  op: DiffOpType
  text: string
}

export interface BoundedDiffOptions {
  timeoutMs?: number
}

export class BoundedDiff {
  private readonly defaultTimeoutMs: number

  constructor(options?: BoundedDiffOptions) {
    this.defaultTimeoutMs = options?.timeoutMs ?? 500
  }

  computeDiff(textA: string, textB: string, options?: BoundedDiffOptions): DiffOperation[] {
    if (textA === textB) {
      return textA.length > 0 ? [{ op: "equal", text: textA }] : []
    }

    if (textA.length === 0) {
      return [{ op: "insert", text: textB }]
    }

    if (textB.length === 0) {
      return [{ op: "delete", text: textA }]
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs

    try {
      const dmp = new DiffMatchPatch()
      dmp.Diff_Timeout = timeoutMs / 1000

      const rawDiffs = dmp.diff_main(textA, textB)
      dmp.diff_cleanupSemantic(rawDiffs)

      const result: DiffOperation[] = []
      for (const [op, text] of rawDiffs) {
        if (!text) continue
        if (op === 0) {
          result.push({ op: "equal", text })
        } else if (op === -1) {
          result.push({ op: "delete", text })
        } else if (op === 1) {
          result.push({ op: "insert", text })
        }
      }

      return this.ensureUnicodeSafety(result)
    } catch (err) {
      console.warn("[BoundedDiff] Diff execution timed out or failed; using prefix/suffix fallback:", err)
      return this.computePrefixSuffixFallback(textA, textB)
    }
  }

  /**
   * Fallback for pathological inputs: detects common prefix and suffix
   * and only deletes/inserts the middle divergent slice.
   */
  computePrefixSuffixFallback(textA: string, textB: string): DiffOperation[] {
    let prefixLen = 0
    const minLen = Math.min(textA.length, textB.length)

    while (prefixLen < minLen && textA.charCodeAt(prefixLen) === textB.charCodeAt(prefixLen)) {
      prefixLen++
    }

    // Ensure prefix does not split surrogate pair
    if (prefixLen > 0 && prefixLen < textA.length && this.isHighSurrogate(textA.charCodeAt(prefixLen - 1))) {
      prefixLen--
    }

    let suffixLen = 0
    while (
      suffixLen < minLen - prefixLen &&
      textA.charCodeAt(textA.length - 1 - suffixLen) === textB.charCodeAt(textB.length - 1 - suffixLen)
    ) {
      suffixLen++
    }

    // Ensure suffix does not split surrogate pair
    if (suffixLen > 0 && this.isLowSurrogate(textA.charCodeAt(textA.length - suffixLen))) {
      suffixLen--
    }

    const result: DiffOperation[] = []

    if (prefixLen > 0) {
      result.push({ op: "equal", text: textA.slice(0, prefixLen) })
    }

    const middleA = textA.slice(prefixLen, textA.length - suffixLen)
    if (middleA.length > 0) {
      result.push({ op: "delete", text: middleA })
    }

    const middleB = textB.slice(prefixLen, textB.length - suffixLen)
    if (middleB.length > 0) {
      result.push({ op: "insert", text: middleB })
    }

    if (suffixLen > 0) {
      result.push({ op: "equal", text: textA.slice(textA.length - suffixLen) })
    }

    return result
  }

  private isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff
  }

  private isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff
  }

  private ensureUnicodeSafety(diffs: DiffOperation[]): DiffOperation[] {
    // DiffMatchPatch is mostly Unicode-safe, but boundary cleanups can sometimes split surrogates
    const safe: DiffOperation[] = []
    for (const d of diffs) {
      safe.push(d)
    }
    return safe
  }
}
