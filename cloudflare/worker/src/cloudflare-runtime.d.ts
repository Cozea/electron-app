interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectNamespace<T = DurableObjectStub> {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): T
}

interface DurableObjectState<T = unknown> {
  acceptWebSocket(socket: WebSocket): void
  getWebSockets(tag?: string): WebSocket[]
  blockConcurrencyWhile<R>(callback: () => Promise<R>): Promise<R>
  storage: DurableObjectStorage
}

interface DurableObjectListOptions {
  start?: string
  startAfter?: string
  end?: string
  prefix?: string
  reverse?: boolean
  limit?: number
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options?: DurableObjectListOptions): Promise<Map<string, T>>
  transaction<T>(closure: (transaction: DurableObjectStorage) => Promise<T>): Promise<T>
}

/** WebSocket Hibernation: per-socket state that survives eviction of the object. */
interface WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

interface DurableObject {
  fetch(request: Request): Promise<Response>
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
