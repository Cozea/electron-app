export interface EncryptedCollabOutboxRecord {
  id: string
  projectId: string
  roomId: string
  keyVersion: number
  updateBinary: string
  timestamp: number
}

interface OutboxBackend {
  put(record: EncryptedCollabOutboxRecord): Promise<void>
  list(roomId: string, keyVersion: number): Promise<EncryptedCollabOutboxRecord[]>
  remove(id: string): Promise<void>
  clearRoom(roomId: string): Promise<void>
  close(): void
}

const DATABASE_NAME = "cozea-collaboration-v2"
const DATABASE_VERSION = 1
const STORE_NAME = "encrypted-outbox"

class MemoryOutboxBackend implements OutboxBackend {
  private readonly records = new Map<string, EncryptedCollabOutboxRecord>()

  async put(record: EncryptedCollabOutboxRecord): Promise<void> {
    this.records.set(record.id, { ...record })
  }

  async list(roomId: string, keyVersion: number): Promise<EncryptedCollabOutboxRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.roomId === roomId && record.keyVersion === keyVersion)
      .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
  }

  async clearRoom(roomId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.roomId === roomId) this.records.delete(id)
    }
  }

  close(): void {}
}

class IndexedDbOutboxBackend implements OutboxBackend {
  private readonly dbPromise: Promise<IDBDatabase>

  constructor(factory: IDBFactory) {
    this.dbPromise = new Promise((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onerror = () => reject(request.error ?? new Error("Failed to open collaboration outbox"))
      request.onupgradeneeded = () => {
        const db = request.result
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: "id" })
        if (!store.indexNames.contains("by_room_and_key")) {
          store.createIndex("by_room_and_key", ["roomId", "keyVersion"], { unique: false })
        }
        if (!store.indexNames.contains("by_room")) {
          store.createIndex("by_room", "roomId", { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
    })
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
  ): Promise<T> {
    const db = await this.dbPromise
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      transaction.onerror = () => reject(transaction.error ?? new Error("Collaboration outbox transaction failed"))
      operation(transaction.objectStore(STORE_NAME), resolve, reject)
    })
  }

  async put(record: EncryptedCollabOutboxRecord): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async list(roomId: string, keyVersion: number): Promise<EncryptedCollabOutboxRecord[]> {
    return await this.transaction<EncryptedCollabOutboxRecord[]>("readonly", (store, resolve, reject) => {
      const request = store.index("by_room_and_key").getAll([roomId, keyVersion])
      request.onsuccess = () => {
        const records = (request.result as EncryptedCollabOutboxRecord[])
          .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
        resolve(records)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async remove(id: string): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.index("by_room").openKeyCursor(IDBKeyRange.only(roomId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        store.delete(cursor.primaryKey)
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  close(): void {
    void this.dbPromise.then((db) => db.close())
  }
}

export class EncryptedCollabOutbox {
  private readonly backend: OutboxBackend

  constructor(factory: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB) {
    this.backend = factory ? new IndexedDbOutboxBackend(factory) : new MemoryOutboxBackend()
  }

  async enqueue(record: EncryptedCollabOutboxRecord): Promise<void> {
    if (!record.updateBinary.trim()) throw new Error("Encrypted update payload is required")
    await this.backend.put({ ...record })
  }

  async list(roomId: string, keyVersion: number): Promise<EncryptedCollabOutboxRecord[]> {
    return await this.backend.list(roomId, keyVersion)
  }

  async acknowledge(id: string): Promise<void> {
    await this.backend.remove(id)
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.backend.clearRoom(roomId)
  }

  close(): void {
    this.backend.close()
  }
}
