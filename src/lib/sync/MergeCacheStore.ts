const DEFAULT_MAX_MEMORY_ENTRIES = 256
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface MergeCacheRecord {
  key: string
  mergedContent: string
  hasConflicts: boolean
  conflictCount: number
  createdAt: number
  lastUsedAt: number
  hitCount: number
  engine: "git-merge-file"
  strategy: "zdiff3" | "diff3"
  gitVersion: string
  baseHash: string
  localHash: string
  cloudHash: string
}

export interface ConflictResolutionRecord {
  fingerprint: string
  resolvedContent: string
  createdAt: number
  lastUsedAt: number
  hitCount: number
}

export interface MergeCacheKeyParts {
  baseHash: string
  localHash: string
  cloudHash: string
  mergeMode: "text-3way"
  gitVersion: string
  strategyVersion: string
}

function normalizeContentForFingerprint(content: string): string {
  return content.replace(/\r\n/g, "\n").trim()
}

export async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const bytes = new Uint8Array(hashBuffer)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function buildMergeCacheKey(parts: MergeCacheKeyParts): string {
  return [
    parts.baseHash,
    parts.localHash,
    parts.cloudHash,
    parts.mergeMode,
    parts.gitVersion,
    parts.strategyVersion,
  ].join(":")
}

export async function buildConflictFingerprint(
  baseContent: string,
  localContent: string,
  cloudContent: string
): Promise<string> {
  const normalized = [
    normalizeContentForFingerprint(baseContent),
    normalizeContentForFingerprint(localContent),
    normalizeContentForFingerprint(cloudContent),
  ].join("\n<<::>>\n")
  return sha256Hex(normalized)
}

export class MergeCacheStore {
  private memoryCache = new Map<string, MergeCacheRecord>()
  private conflictMemory = new Map<string, ConflictResolutionRecord>()
  private maxMemoryEntries: number
  private ttlMs: number

  constructor(options?: { maxMemoryEntries?: number; ttlMs?: number }) {
    this.maxMemoryEntries = options?.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_ENTRIES
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  private canUsePersistentCache(): boolean {
    const syncApi = window.electronAPI?.sync as unknown as Record<string, unknown> | undefined
    return Boolean(syncApi?.mergeCacheGet && syncApi?.mergeCacheSet)
  }

  private touchMemory(record: MergeCacheRecord): MergeCacheRecord {
    const touched: MergeCacheRecord = {
      ...record,
      hitCount: record.hitCount + 1,
      lastUsedAt: Date.now(),
    }

    this.memoryCache.delete(record.key)
    this.memoryCache.set(record.key, touched)
    if (this.memoryCache.size > this.maxMemoryEntries) {
      const oldest = this.memoryCache.keys().next().value
      if (oldest) this.memoryCache.delete(oldest)
    }
    return touched
  }

  private touchResolutionMemory(record: ConflictResolutionRecord): ConflictResolutionRecord {
    const touched: ConflictResolutionRecord = {
      ...record,
      hitCount: record.hitCount + 1,
      lastUsedAt: Date.now(),
    }
    this.conflictMemory.set(record.fingerprint, touched)
    if (this.conflictMemory.size > this.maxMemoryEntries) {
      const oldest = this.conflictMemory.keys().next().value
      if (oldest) this.conflictMemory.delete(oldest)
    }
    return touched
  }

  async get(key: string): Promise<MergeCacheRecord | null> {
    const fromMemory = this.memoryCache.get(key)
    if (fromMemory) {
      if (Date.now() - fromMemory.createdAt <= this.ttlMs) {
        return this.touchMemory(fromMemory)
      }
      this.memoryCache.delete(key)
    }

    if (!this.canUsePersistentCache()) return null

    const fromStore = await window.electronAPI.sync.mergeCacheGet({ key })
    if (!fromStore) return null

    if (Date.now() - fromStore.createdAt > this.ttlMs) {
      await this.delete(key)
      return null
    }

    const touched = this.touchMemory(fromStore)
    await this.set(touched)
    return touched
  }

  async set(record: MergeCacheRecord): Promise<void> {
    const now = Date.now()
    const normalized: MergeCacheRecord = {
      ...record,
      createdAt: record.createdAt || now,
      lastUsedAt: record.lastUsedAt || now,
      hitCount: Math.max(0, record.hitCount),
    }

    this.memoryCache.set(normalized.key, normalized)
    if (this.memoryCache.size > this.maxMemoryEntries) {
      const oldest = this.memoryCache.keys().next().value
      if (oldest) this.memoryCache.delete(oldest)
    }

    if (!this.canUsePersistentCache()) return
    await window.electronAPI.sync.mergeCacheSet({ record: normalized })
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key)
    if (!this.canUsePersistentCache()) return
    await window.electronAPI.sync.mergeCacheDelete({ key })
  }

  async saveResolvedConflict(record: ConflictResolutionRecord): Promise<void> {
    const normalized: ConflictResolutionRecord = {
      ...record,
      createdAt: record.createdAt || Date.now(),
      lastUsedAt: record.lastUsedAt || Date.now(),
      hitCount: Math.max(0, record.hitCount),
    }
    this.conflictMemory.set(record.fingerprint, normalized)
    if (this.conflictMemory.size > this.maxMemoryEntries) {
      const oldest = this.conflictMemory.keys().next().value
      if (oldest) this.conflictMemory.delete(oldest)
    }

    if (!this.canUsePersistentCache()) return
    await window.electronAPI.sync.mergeCacheSaveResolved({ record: normalized })
  }

  async getResolvedConflict(fingerprint: string): Promise<ConflictResolutionRecord | null> {
    const fromMemory = this.conflictMemory.get(fingerprint)
    if (fromMemory) {
      if (Date.now() - fromMemory.createdAt <= this.ttlMs) {
        const touched = this.touchResolutionMemory(fromMemory)
        await this.saveResolvedConflict(touched)
        return touched
      }
      this.conflictMemory.delete(fingerprint)
    }

    if (!this.canUsePersistentCache()) return null

    const fromStore = await window.electronAPI.sync.mergeCacheGetResolved({ fingerprint })
    if (!fromStore) return null
    if (Date.now() - fromStore.createdAt > this.ttlMs) return null

    const touched = this.touchResolutionMemory(fromStore)
    await this.saveResolvedConflict(touched)
    return touched
  }

  async prune(): Promise<void> {
    const threshold = Date.now() - this.ttlMs
    for (const [key, value] of this.memoryCache.entries()) {
      if (value.createdAt < threshold) {
        this.memoryCache.delete(key)
      }
    }
    for (const [key, value] of this.conflictMemory.entries()) {
      if (value.createdAt < threshold) {
        this.conflictMemory.delete(key)
      }
    }

    if (!this.canUsePersistentCache()) return
    await window.electronAPI.sync.mergeCachePrune({
      threshold,
      maxEntries: this.maxMemoryEntries * 20,
    })
  }
}

export const mergeCacheStore = new MergeCacheStore()
