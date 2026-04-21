interface StoredEncryptedSnapshotRecord {
  scopeKey: string
  keyVersion: number
  envelopeJson: string
  updatedAt: number
}

const DB_NAME = 'cozea-collab-encrypted'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'scopeKey' })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

export class EncryptedLocalSnapshotStore {
  async load(scopeKey: string): Promise<StoredEncryptedSnapshotRecord | null> {
    const database = await openDatabase()
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(scopeKey)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        resolve((request.result as StoredEncryptedSnapshotRecord | undefined) ?? null)
      }
    })
  }

  async save(record: StoredEncryptedSnapshotRecord): Promise<void> {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(record)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async clear(scopeKey: string): Promise<void> {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(scopeKey)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }
}
