interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectState {
  acceptWebSocket(socket: WebSocket): void
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
  }
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
