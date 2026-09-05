interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectNamespace<T = DurableObjectStub> {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): T
}

interface DurableObjectState<T = unknown> {
  acceptWebSocket(socket: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
  storage: DurableObjectStorage
}

interface DurableObjectStorageListOptions {
  prefix?: string
  start?: string
  end?: string
  limit?: number
  reverse?: boolean
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  deleteAll(): Promise<void>
  list<T>(options?: DurableObjectStorageListOptions): Promise<Map<string, T>>
  transaction<T>(closure: (transaction: DurableObjectStorage) => Promise<T>): Promise<T>
}

interface DurableObject {
  fetch(request: Request): Promise<Response>
}

interface WebSocket {
  serializeAttachment(attachment: unknown): void
  deserializeAttachment<T = unknown>(): T | null
}

interface WebSocketPair {
  0: WebSocket
  1: WebSocket
}

declare const WebSocketPair: {
  new (): WebSocketPair
}

interface ResponseInit {
  webSocket?: WebSocket
}

interface ExportedHandler<Env> {
  fetch(request: Request, env: Env): Promise<Response>
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>
  size: number
  httpMetadata?: { contentType?: string }
}

interface R2Bucket {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
    options?: {
      sha256?: ArrayBuffer | Uint8Array
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
}
