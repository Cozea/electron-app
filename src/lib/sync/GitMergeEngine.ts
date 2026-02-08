import {
  buildConflictFingerprint,
  buildMergeCacheKey,
  mergeCacheStore,
  sha256Hex,
  type MergeCacheRecord,
} from "./MergeCacheStore"

const MERGE_STRATEGY_VERSION = "v1"

export interface GitRuntimeHealth {
  available: boolean
  executablePath?: string
  source: "bundled" | "system" | "missing"
  gitVersion?: string
  supportsMergeFile: boolean
  supportsZdiff3: boolean
  supportsMergeTree: boolean
  supportsMergeTreeWriteTree: boolean
  preflightCheckedAt: number
  preflightOk: boolean
  error?: string
}

export interface GitMergeStats {
  localChanges: number
  cloudChanges: number
  unchanged: number
  conflictCount: number
}

export interface GitMergeConflict {
  startLine: number
  endLine: number
}

export interface GitMergeResult {
  success: boolean
  merged: string
  hasConflicts: boolean
  stats: GitMergeStats
  conflicts: GitMergeConflict[]
  engine: "git-merge-file"
  strategy: "zdiff3" | "diff3"
  gitVersion: string
  baseHash: string
  localHash: string
  cloudHash: string
  cacheHit: boolean
  conflictFingerprint?: string
}

export interface GitMergeTreeFile {
  path: string
  content: string
}

export interface GitMergeTreeConflict {
  path: string
  message?: string
}

export interface GitMergeTreeResult {
  success: boolean
  clean: boolean
  treeOid?: string
  conflicts: GitMergeTreeConflict[]
  mergedFiles: GitMergeTreeFile[]
  gitVersion: string
  rawOutput?: string
  error?: string
}

interface MergePreviewResponse {
  success: boolean
  mergedContent: string
  hasConflicts: boolean
  conflictCount: number
  strategyUsed: "zdiff3" | "diff3"
  gitVersion: string
  error?: string
}

interface MergeTreePreviewResponse {
  success: boolean
  clean: boolean
  treeOid?: string
  conflicts: Array<{ path: string; message?: string }>
  mergedFiles: Array<{ path: string; content: string }>
  gitVersion: string
  rawOutput?: string
  error?: string
}

function countOccurrences(content: string, marker: string): number {
  if (!content) return 0
  let index = 0
  let count = 0
  while (index >= 0) {
    index = content.indexOf(marker, index)
    if (index >= 0) {
      count++
      index += marker.length
    }
  }
  return count
}

function findConflictRanges(merged: string): GitMergeConflict[] {
  const lines = merged.split("\n")
  const ranges: GitMergeConflict[] = []

  let currentStart: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith("<<<<<<< ")) {
      currentStart = i + 1
    } else if (line.startsWith(">>>>>>> ") && currentStart !== null) {
      ranges.push({
        startLine: currentStart,
        endLine: i + 1,
      })
      currentStart = null
    }
  }

  return ranges
}

function buildResultFromCache(record: MergeCacheRecord): GitMergeResult {
  const merged = record.mergedContent
  return {
    success: !record.hasConflicts,
    merged,
    hasConflicts: record.hasConflicts,
    stats: {
      localChanges: 1,
      cloudChanges: 1,
      unchanged: Math.max(0, merged.split("\n").length - record.conflictCount),
      conflictCount: record.conflictCount,
    },
    conflicts: findConflictRanges(merged),
    engine: "git-merge-file",
    strategy: record.strategy,
    gitVersion: record.gitVersion,
    baseHash: record.baseHash,
    localHash: record.localHash,
    cloudHash: record.cloudHash,
    cacheHit: true,
  }
}

export class GitMergeEngine {
  private healthCache: GitRuntimeHealth | null = null

  constructor() {
    void mergeCacheStore.prune().catch(() => {
      // Non-fatal cache maintenance.
    })
  }

  async getRuntimeHealth(force = false): Promise<GitRuntimeHealth> {
    if (!force && this.healthCache?.preflightOk) {
      return this.healthCache
    }
    const health = await window.electronAPI.sync.getGitRuntimeHealth({ force })
    this.healthCache = health
    return health
  }

  async merge(base: string, local: string, cloud: string): Promise<GitMergeResult> {
    if (local === cloud) {
      const baseHash = await sha256Hex(base)
      const localHash = await sha256Hex(local)
      return {
        success: true,
        merged: local,
        hasConflicts: false,
        stats: {
          localChanges: 0,
          cloudChanges: 0,
          unchanged: 1,
          conflictCount: 0,
        },
        conflicts: [],
        engine: "git-merge-file",
        strategy: "zdiff3",
        gitVersion: this.healthCache?.gitVersion ?? "unknown",
        baseHash,
        localHash,
        cloudHash: localHash,
        cacheHit: false,
      }
    }

    const [baseHash, localHash, cloudHash] = await Promise.all([
      sha256Hex(base),
      sha256Hex(local),
      sha256Hex(cloud),
    ])

    const health = await this.getRuntimeHealth()
    if (!health.available || !health.preflightOk) {
      throw new Error(health.error ?? "Git runtime is not available")
    }

    const cacheKey = buildMergeCacheKey({
      baseHash,
      localHash,
      cloudHash,
      mergeMode: "text-3way",
      gitVersion: health.gitVersion ?? "unknown",
      strategyVersion: MERGE_STRATEGY_VERSION,
    })

    const cached = await mergeCacheStore.get(cacheKey)
    if (cached) {
      return buildResultFromCache(cached)
    }

    const reuse = await mergeCacheStore.getResolvedConflict(
      await buildConflictFingerprint(base, local, cloud)
    )
    if (reuse) {
      const merged = reuse.resolvedContent
      return {
        success: true,
        merged,
        hasConflicts: false,
        stats: {
          localChanges: Number(local !== base),
          cloudChanges: Number(cloud !== base),
          unchanged: Math.max(0, merged.split("\n").length),
          conflictCount: 0,
        },
        conflicts: [],
        engine: "git-merge-file",
        strategy: health.supportsZdiff3 ? "zdiff3" : "diff3",
        gitVersion: health.gitVersion ?? "unknown",
        baseHash,
        localHash,
        cloudHash,
        cacheHit: true,
      }
    }

    const preview = (await window.electronAPI.sync.mergePreview({
      baseContent: base,
      localContent: local,
      cloudContent: cloud,
      strategy: health.supportsZdiff3 ? "zdiff3" : "diff3",
      labels: {
        local: "LOCAL",
        base: "BASE",
        cloud: "CLOUD",
      },
    })) as MergePreviewResponse

    if (!preview.success) {
      throw new Error(preview.error ?? "Git merge preview failed")
    }

    const conflictCount = preview.hasConflicts
      ? Math.max(preview.conflictCount, countOccurrences(preview.mergedContent, "<<<<<<< "))
      : 0

    const cacheRecord: MergeCacheRecord = {
      key: cacheKey,
      mergedContent: preview.mergedContent,
      hasConflicts: preview.hasConflicts,
      conflictCount,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      hitCount: 0,
      engine: "git-merge-file",
      strategy: preview.strategyUsed,
      gitVersion: preview.gitVersion,
      baseHash,
      localHash,
      cloudHash,
    }
    await mergeCacheStore.set(cacheRecord)

    const merged = preview.mergedContent
    return {
      success: !preview.hasConflicts,
      merged,
      hasConflicts: preview.hasConflicts,
      stats: {
        localChanges: Number(local !== base),
        cloudChanges: Number(cloud !== base),
        unchanged: Math.max(0, merged.split("\n").length - conflictCount),
        conflictCount,
      },
      conflicts: findConflictRanges(merged),
      engine: "git-merge-file",
      strategy: preview.strategyUsed,
      gitVersion: preview.gitVersion,
      baseHash,
      localHash,
      cloudHash,
      cacheHit: false,
      conflictFingerprint: preview.hasConflicts
        ? await buildConflictFingerprint(base, local, cloud)
        : undefined,
    }
  }

  async mergeTree(input: {
    baseFiles: GitMergeTreeFile[]
    localFiles: GitMergeTreeFile[]
    cloudFiles: GitMergeTreeFile[]
    maxPreviewFiles?: number
    maxPreviewBytes?: number
  }): Promise<GitMergeTreeResult> {
    const health = await this.getRuntimeHealth()
    if (!health.available || !health.supportsMergeTree || !health.supportsMergeTreeWriteTree) {
      return {
        success: false,
        clean: false,
        conflicts: [],
        mergedFiles: [],
        gitVersion: health.gitVersion ?? "unknown",
        error: health.error ?? "Git merge-tree runtime is unavailable",
      }
    }

    const response = (await window.electronAPI.sync.mergeTreePreview({
      baseFiles: input.baseFiles,
      localFiles: input.localFiles,
      cloudFiles: input.cloudFiles,
      maxPreviewFiles: input.maxPreviewFiles,
      maxPreviewBytes: input.maxPreviewBytes,
    })) as MergeTreePreviewResponse

    return {
      success: response.success,
      clean: response.clean,
      treeOid: response.treeOid,
      conflicts: response.conflicts,
      mergedFiles: response.mergedFiles,
      gitVersion: response.gitVersion,
      rawOutput: response.rawOutput,
      error: response.error,
    }
  }

  async saveResolvedConflict(
    baseContent: string,
    localContent: string,
    cloudContent: string,
    resolvedContent: string
  ): Promise<void> {
    const fingerprint = await buildConflictFingerprint(baseContent, localContent, cloudContent)
    await mergeCacheStore.saveResolvedConflict({
      fingerprint,
      resolvedContent,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      hitCount: 0,
    })

    await window.electronAPI.sync.resolveConflict({
      fingerprint,
      resolvedContent,
    })
  }
}

export const gitMergeEngine = new GitMergeEngine()
