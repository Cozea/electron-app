import { diff3Merge } from 'node-diff3'

/**
 * Statistics about a merge operation.
 */
export interface MergeStats {
  /** Number of changes accepted from local version */
  localChanges: number
  /** Number of changes accepted from cloud version */
  cloudChanges: number
  /** Number of unchanged regions */
  unchanged: number
  /** Number of conflicting regions */
  conflictCount: number
}

/**
 * A region where both sides made conflicting changes.
 */
export interface ConflictRegion {
  /** Starting line number in the merged output */
  startLine: number
  /** Ending line number in the merged output */
  endLine: number
  /** Content from the base (common ancestor) */
  baseContent: string
  /** Content from the local version */
  localContent: string
  /** Content from the cloud version */
  cloudContent: string
}

/**
 * Result of a 3-way merge operation.
 */
export interface MergeResult {
  /** Whether the merge succeeded without conflicts */
  success: boolean
  /** The merged content (may contain conflict markers if not clean) */
  merged: string
  /** Whether there were any conflicts */
  hasConflicts: boolean
  /** Details about what was merged */
  stats: MergeStats
  /** Conflict regions if any */
  conflicts: ConflictRegion[]
}

/**
 * ThreeWayMerge - Implements true Git-like 3-way merge using node-diff3.
 *
 * Algorithm (true diff3 with LCS):
 * 1. Split all three versions into lines
 * 2. Find longest common subsequence (LCS) between base↔local and base↔cloud
 * 3. Identify stable chunks where all three agree
 * 4. Between stable chunks:
 *    - If only local changed → take local
 *    - If only cloud changed → take cloud
 *    - If both changed identically → take either
 *    - If both changed differently → CONFLICT
 *
 * This is the same algorithm Git uses for merging.
 */
export class ThreeWayMerge {
  /**
   * Perform 3-way merge.
   *
   * @param base - Common ancestor content (checkpoint from last sync)
   * @param local - Current local content
   * @param cloud - Current cloud content
   * @returns Merge result with success status and merged content
   */
  merge(base: string, local: string, cloud: string): MergeResult {
    // Fast path: if local and cloud are identical, no merge needed
    if (local === cloud) {
      return {
        success: true,
        merged: local,
        hasConflicts: false,
        stats: { localChanges: 0, cloudChanges: 0, unchanged: 1, conflictCount: 0 },
        conflicts: [],
      }
    }

    // Fast path: if local unchanged from base, take cloud entirely
    if (local === base) {
      return {
        success: true,
        merged: cloud,
        hasConflicts: false,
        stats: { localChanges: 0, cloudChanges: 1, unchanged: 0, conflictCount: 0 },
        conflicts: [],
      }
    }

    // Fast path: if cloud unchanged from base, take local entirely
    if (cloud === base) {
      return {
        success: true,
        merged: local,
        hasConflicts: false,
        stats: { localChanges: 1, cloudChanges: 0, unchanged: 0, conflictCount: 0 },
        conflicts: [],
      }
    }

    // Both changed - perform true diff3 merge
    return this.performDiff3Merge(base, local, cloud)
  }

  /**
   * Perform true line-based diff3 merge using node-diff3.
   */
  private performDiff3Merge(base: string, local: string, cloud: string): MergeResult {
    const baseLines = base.split('\n')
    const localLines = local.split('\n')
    const cloudLines = cloud.split('\n')

    // diff3Merge(a, o, b) - a=local, o=base, b=cloud
    // excludeFalseConflicts: if both sides made identical changes, don't conflict
    const regions = diff3Merge(localLines, baseLines, cloudLines, {
      excludeFalseConflicts: true,
    })

    const mergedLines: string[] = []
    const conflicts: ConflictRegion[] = []
    let localChanges = 0
    let cloudChanges = 0
    let unchanged = 0

    for (const region of regions) {
      if ('ok' in region) {
        // Non-conflicting region - could be unchanged or accepted from one side
        mergedLines.push(...region.ok)
        unchanged++
      } else if ('conflict' in region) {
        // Conflicting region - both sides changed the same lines differently
        const { a: localConflict, o: baseConflict, b: cloudConflict } = region.conflict

        conflicts.push({
          startLine: mergedLines.length + 1,
          endLine: mergedLines.length + localConflict.length + cloudConflict.length + 4,
          baseContent: baseConflict.join('\n'),
          localContent: localConflict.join('\n'),
          cloudContent: cloudConflict.join('\n'),
        })

        // Add conflict markers (Git-style)
        mergedLines.push('<<<<<<< LOCAL')
        mergedLines.push(...localConflict)
        mergedLines.push('=======')
        mergedLines.push(...cloudConflict)
        mergedLines.push('>>>>>>> CLOUD')
      }
    }

    // Count changes by diffing against base
    // A simple heuristic: count regions that differ from base
    const localDiffRegions = diff3Merge(localLines, baseLines, baseLines, { excludeFalseConflicts: true })
    const cloudDiffRegions = diff3Merge(cloudLines, baseLines, baseLines, { excludeFalseConflicts: true })

    for (const region of localDiffRegions) {
      if ('ok' in region) {
        // Check if this region differs from what base would produce
        const baseCheck = diff3Merge(baseLines, baseLines, baseLines)
        if (baseCheck.length !== localDiffRegions.length) {
          localChanges++
        }
      }
    }

    // Simplified: count non-trivial regions as changes
    localChanges = Math.max(1, localDiffRegions.filter(r => 'ok' in r).length - 1)
    cloudChanges = Math.max(1, cloudDiffRegions.filter(r => 'ok' in r).length - 1)

    // If no conflicts, the counts are approximations of hunks changed
    if (conflicts.length === 0 && localChanges === 0 && cloudChanges === 0) {
      // Both made changes that merged cleanly
      localChanges = 1
      cloudChanges = 1
    }

    return {
      success: conflicts.length === 0,
      merged: mergedLines.join('\n'),
      hasConflicts: conflicts.length > 0,
      stats: {
        localChanges,
        cloudChanges,
        unchanged,
        conflictCount: conflicts.length,
      },
      conflicts,
    }
  }

  /**
   * Check if a file can be merged without conflicts.
   * Useful for quick pre-check before attempting full merge.
   *
   * @param base - Common ancestor content
   * @param local - Current local content
   * @param cloud - Current cloud content
   * @returns true if merge would succeed without conflicts
   */
  canMergeCleanly(base: string, local: string, cloud: string): boolean {
    // Quick checks first
    if (local === cloud) return true
    if (local === base || cloud === base) return true

    // Try actual merge
    const result = this.merge(base, local, cloud)
    return result.success
  }

  /**
   * Get a human-readable description of the merge.
   *
   * @param result - The merge result
   * @returns Description string for UI display
   */
  describeMerge(result: MergeResult): string {
    if (result.hasConflicts) {
      return `${result.stats.conflictCount} conflict${result.stats.conflictCount > 1 ? 's' : ''} - manual resolution required`
    }

    const parts: string[] = []
    if (result.stats.localChanges > 0) {
      parts.push(`${result.stats.localChanges} local`)
    }
    if (result.stats.cloudChanges > 0) {
      parts.push(`${result.stats.cloudChanges} cloud`)
    }

    if (parts.length === 0) {
      return 'No changes'
    }

    return `Merged: ${parts.join(' + ')} change${result.stats.localChanges + result.stats.cloudChanges > 1 ? 's' : ''}`
  }
}

// Singleton instance
export const threeWayMerge = new ThreeWayMerge()
