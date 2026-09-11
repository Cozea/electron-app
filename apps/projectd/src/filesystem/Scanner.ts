/**
 * Full workspace tree scanner and materialization audit.
 *
 * Master Specification: Section 12.3, 12.4, 12.10
 */

import fs from "node:fs/promises"
import path from "node:path"

import type { ScopePolicy } from "./ScopePolicy"
import { StableFileReader } from "./StableRead"
import type { MaterializationIndex, MaterializedEntry } from "./MaterializationIndex"

export interface FileScanItem {
  relativePath: string
  absolutePath: string
  size: number
  mtimeMs: number
  mode: number
  inode: number
  isSymlink: boolean
  contentHash?: string
}

export interface ScanDiff {
  created: FileScanItem[]
  modified: FileScanItem[]
  deleted: MaterializedEntry[]
  unmodifiedCount: number
  totalScanned: number
}

export class WorkspaceScanner {
  readonly workspaceRoot: string
  readonly scopePolicy: ScopePolicy
  readonly stableReader: StableFileReader

  constructor(workspaceRoot: string, scopePolicy: ScopePolicy, stableReader?: StableFileReader) {
    this.workspaceRoot = path.resolve(workspaceRoot)
    this.scopePolicy = scopePolicy
    this.stableReader = stableReader ?? new StableFileReader({ settleDelayMs: 0 })
  }

  /**
   * Recursively scans directory and collects in-scope files.
   */
  async scanTree(): Promise<FileScanItem[]> {
    const items: FileScanItem[] = []
    const queue: string[] = [this.workspaceRoot]

    while (queue.length > 0) {
      const currentDir = queue.shift()!
      let dirEntries: fs.Dirent[]

      try {
        dirEntries = await fs.readdir(currentDir, { withFileTypes: true })
      } catch (err: any) {
        if (err.code === "ENOENT") continue
        console.warn(`[WorkspaceScanner] Cannot read directory ${currentDir}:`, err)
        continue
      }

      const filesToCheck: { rel: string; abs: string; dirent: fs.Dirent }[] = []

      for (const entry of dirEntries) {
        const absPath = path.join(currentDir, entry.name)
        const relPath = this.scopePolicy.normalizeRelativePath(absPath)

        if (this.scopePolicy.isAlwaysIgnored(relPath)) {
          continue
        }

        if (entry.isDirectory()) {
          queue.push(absPath)
        } else {
          filesToCheck.push({ rel: relPath, abs: absPath, dirent: entry })
        }
      }

      if (filesToCheck.length === 0) continue

      // Filter against Git ignore rules
      const candidateRels = filesToCheck.map((f) => f.rel)
      const inScopeRels = new Set(await this.scopePolicy.filterInScopePaths(candidateRels))

      for (const file of filesToCheck) {
        if (!inScopeRels.has(file.rel)) continue

        try {
          const stat = await fs.lstat(file.abs)
          items.push({
            relativePath: file.rel,
            absolutePath: file.abs,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
            inode: stat.ino,
            isSymlink: stat.isSymbolicLink(),
          })
        } catch {
          // File may have been removed concurrently
        }
      }
    }

    return items
  }

  /**
   * Compares the current filesystem state against the materialization index
   * and computes created, modified, and deleted differences.
   */
  async diffAgainstIndex(sessionId: string, index: MaterializationIndex): Promise<ScanDiff> {
    const scanned = await this.scanTree()
    const indexed = index.list(sessionId)
    const indexedByPath = new Map<string, MaterializedEntry>()
    for (const entry of indexed) {
      indexedByPath.set(index.normalizePath(entry.relativePath), entry)
    }

    const created: FileScanItem[] = []
    const modified: FileScanItem[] = []
    let unmodifiedCount = 0

    const seenIndexedPaths = new Set<string>()

    for (const item of scanned) {
      const normPath = index.normalizePath(item.relativePath)
      const existing = indexedByPath.get(normPath)

      if (!existing) {
        // Newly discovered file
        const stable = await this.stableReader.read(item.absolutePath, { skipInitialDelay: true })
        if (stable.exists && stable.contentHash) {
          created.push({
            ...item,
            contentHash: stable.contentHash,
          })
        }
      } else {
        seenIndexedPaths.add(normPath)

        // Fast check: size and mtime
        if (existing.diskSize === item.size && existing.diskMtimeMs === item.mtimeMs) {
          unmodifiedCount += 1
          continue
        }

        // Potential modification: verify stable hash
        const stable = await this.stableReader.read(item.absolutePath, { skipInitialDelay: true })
        if (stable.exists && stable.contentHash) {
          if (stable.contentHash !== existing.diskHash) {
            modified.push({
              ...item,
              contentHash: stable.contentHash,
            })
          } else {
            unmodifiedCount += 1
          }
        } else {
          // Disappeared during read
          modified.push(item)
        }
      }
    }

    // Identify deleted files: in index but missing from disk
    const deleted: MaterializedEntry[] = []
    for (const [p, entry] of indexedByPath.entries()) {
      if (!seenIndexedPaths.has(p)) {
        deleted.push(entry)
      }
    }

    return {
      created,
      modified,
      deleted,
      unmodifiedCount,
      totalScanned: scanned.length,
    }
  }
}
