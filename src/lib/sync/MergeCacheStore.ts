const MERGE_CACHE_DB_NAME = "cozea-sync-merge-cache"
const MERGE_CACHE_DB_VERSION = 1
const MERGE_CACHE_STORE = "mergeResults"
const RESOLUTION_CACHE_STORE = "conflictResolutions"

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
  private dbPromise: Promise<IDBDatabase> | null = null
  private maxMemoryEntries: number
  private ttlMs: number

  constructor(options?: { maxMemoryEntries?: number; ttlMs?: number }) {
    this.maxMemoryEntries = options?.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_ENTRIES
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(MERGE_CACHE_DB_NAME, MERGE_CACHE_DB_VERSION)

      request.onerror = () => reject(request.error ?? new Error("Failed to open merge cache DB"))
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(MERGE_CACHE_STORE)) {
          db.createObjectStore(MERGE_CACHE_STORE, { keyPath: "key" })
        }
        if (!db.objectStoreNames.contains(RESOLUTION_CACHE_STORE)) {
          db.createObjectStore(RESOLUTION_CACHE_STORE, { keyPath: "fingerprint" })
        }
      }
    })

    return this.dbPromise
  }

  private touchMemory(record: MergeCacheRecord): MergeCacheRecord {
    const touched = {
      ...record,
      hitCount: record.hitCount + 1,
      lastUsedAt: Date.now(),
    }

    this.memoryCache.delete(record.key)
    this.memoryCache.set(record.key, touched)

    if (this.memoryCache.size > this.maxMemoryEntries) {
      const oldest = this.memoryCache.keys().next().value
      if (oldest) {
        this.memoryCache.delete(oldest)
      }
    }

    return touched
  }

  async get(key: string): Promise<MergeCacheRecord | null> {
    const fromMemory = this.memoryCache.get(key)
    if (fromMemory) {
      if (Date.now() - fromMemory.createdAt > this.ttlMs) {
        this.memoryCache.delete(key)
      } else {
        return this.touchMemory(fromMemory)
      }
    }

    const db = await this.getDb()
    const record = await new Promise<MergeCacheRecord | null>((resolve, reject) => {
      const tx = db.transaction(MERGE_CACHE_STORE, "readonly")
      const store = tx.objectStore(MERGE_CACHE_STORE)
      const req = store.get(key)
      req.onerror = () => reject(req.error ?? new Error("Failed to read merge cache entry"))
      req.onsuccess = () => resolve((req.result as MergeCacheRecord | undefined) ?? null)
    })

    if (!record) return null

    if (Date.now() - record.createdAt > this.ttlMs) {
      await this.delete(key)
      return null
    }

    const touched = this.touchMemory(record)
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

    const db = await this.getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MERGE_CACHE_STORE, "readwrite")
      const store = tx.objectStore(MERGE_CACHE_STORE)
      const req = store.put(normalized)
      req.onerror = () => reject(req.error ?? new Error("Failed to write merge cache entry"))
      req.onsuccess = () => resolve()
    })
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key)
    const db = await this.getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MERGE_CACHE_STORE, "readwrite")
      const store = tx.objectStore(MERGE_CACHE_STORE)
      const req = store.delete(key)
      req.onerror = () => reject(req.error ?? new Error("Failed to delete merge cache entry"))
      req.onsuccess = () => resolve()
    })
  }

  async saveResolvedConflict(record: ConflictResolutionRecord): Promise<void> {
    const db = await this.getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RESOLUTION_CACHE_STORE, "readwrite")
      const store = tx.objectStore(RESOLUTION_CACHE_STORE)
      const req = store.put(record)
      req.onerror = () => reject(req.error ?? new Error("Failed to write conflict resolution"))
      req.onsuccess = () => resolve()
    })
  }

  async getResolvedConflict(fingerprint: string): Promise<ConflictResolutionRecord | null> {
    const db = await this.getDb()
    const record = await new Promise<ConflictResolutionRecord | null>((resolve, reject) => {
      const tx = db.transaction(RESOLUTION_CACHE_STORE, "readonly")
      const store = tx.objectStore(RESOLUTION_CACHE_STORE)
      const req = store.get(fingerprint)
      req.onerror = () => reject(req.error ?? new Error("Failed to read conflict resolution"))
      req.onsuccess = () => resolve((req.result as ConflictResolutionRecord | undefined) ?? null)
    })

    if (!record) return null
    const touched: ConflictResolutionRecord = {
      ...record,
      hitCount: record.hitCount + 1,
      lastUsedAt: Date.now(),
    }
    await this.saveResolvedConflict(touched)
    return touched
  }

  async prune(): Promise<void> {
    const threshold = Date.now() - this.ttlMs
    const db = await this.getDb()

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MERGE_CACHE_STORE, "readwrite")
      const store = tx.objectStore(MERGE_CACHE_STORE)
      const req = store.openCursor()

      req.onerror = () => reject(req.error ?? new Error("Failed to prune merge cache"))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const value = cursor.value as MergeCacheRecord
        if (value.createdAt < threshold) {
          cursor.delete()
        }
        cursor.continue()
      }
    })
  }
}

export const mergeCacheStore = new MergeCacheStore()
