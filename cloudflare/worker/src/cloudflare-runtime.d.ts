interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectState {
  acceptWebSocket(socket: WebSocket): void
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
