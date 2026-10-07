import type http from "node:http"
import { randomBytes } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"

/** Renderer tickets stay at this host; raw T3 tickets never leave the gateway. */
export function attachRendererRpcGateway(options: {
  server: http.Server
  upstreamBaseUrl: string
  issueUpstreamTicket(): Promise<string>
  authorizeRequest(method: string, payload: unknown): Promise<void>
}) {
  const tickets = new Map<string, number>()
  const sockets = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  const issueTicket = async () => {
    const now = Date.now()
    for (const [ticket, expiresAt] of tickets) if (expiresAt < now) tickets.delete(ticket)
    if (tickets.size >= 256) throw new Error("Too many pending chat connection tickets")
    const ticket = randomBytes(32).toString("hex")
    tickets.set(ticket, now + 30_000)
    return ticket
  }
  // Keep the concrete upgrade callback separate from the overloaded EventEmitter type.
  const upgrade = (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname !== "/ws") return
    const ticket = url.searchParams.get("wsTicket") ?? ""
    const expiresAt = tickets.get(ticket)
    tickets.delete(ticket)
    if (!expiresAt || expiresAt < Date.now()) { socket.destroy(); return }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws))
  }
  options.server.on("upgrade", upgrade)
  wss.on("connection", (client) => {
    if (sockets.size >= 256) { client.close(1013, "Too many chat connections"); return }
    sockets.add(client)
    let upstream: WebSocket | null = null
    let queue = Promise.resolve()
    let closed = false
    let queuedBytes = 0
    let queuedFrames = 0
    const connect = options.issueUpstreamTicket().then((ticket) => new Promise<WebSocket>((resolve, reject) => {
      if (closed) { reject(new Error("Chat connection closed")); return }
      const url = new URL("/ws", options.upstreamBaseUrl)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("wsTicket", ticket)
      url.searchParams.set("clientSurface", "web")
      const ws = new WebSocket(url)
      upstream = ws
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("Chat connection timed out")) }, 15_000)
      ws.once("open", () => { clearTimeout(timer); resolve(ws) })
      ws.once("error", () => { clearTimeout(timer); reject(new Error("Chat connection failed")) })
      ws.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }) })
      ws.on("close", () => { clearTimeout(timer); reject(new Error("Chat connection closed")); client.close() })
    }))
    void connect.catch(() => client.close(1011, "Chat server unavailable"))
    client.on("message", (raw, binary) => {
      const size = Array.isArray(raw) ? raw.reduce((total, part) => total + part.byteLength, 0) : raw.byteLength
      if (++queuedFrames > 128 || (queuedBytes += size) > 32 * 1024 * 1024) { client.close(1013, "Chat request queue is full"); return }
      queue = queue.then(async () => {
        const ws = await connect
        if (client.readyState !== WebSocket.OPEN || ws.readyState !== WebSocket.OPEN) return
        let parsed: unknown
        try { parsed = JSON.parse(raw.toString()) } catch { client.close(1007, "Invalid chat frame"); return }
        const frames = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>
        const rejected: Array<{ frame: Record<string, unknown>; error: unknown }> = []
        for (const frame of frames) {
          if (!frame || typeof frame !== "object") { client.close(1007, "Invalid chat frame"); return }
          const method = frame._tag === "Request" ? frame.tag : frame.method
          if (typeof method === "string") {
            try { await options.authorizeRequest(method, frame._tag === "Request" ? frame.payload : frame.params) }
            catch (error) { rejected.push({ frame, error }) }
          }
        }
        if (rejected.length) {
          // Reject the complete batch; no command in a partially authorized batch is forwarded.
          const error = rejected[0].error instanceof Error ? rejected[0].error.message : "Workspace unavailable"
          for (const frame of frames) if (frame.id !== undefined) client.send(JSON.stringify(frame._tag === "Request"
            ? { _tag: "Exit", requestId: frame.id, exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: error }] } }
            : { jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: error } }))
          return
        }
        ws.send(raw, { binary })
      }).catch(() => client.close(1011, "Chat connection failed")).finally(() => { queuedFrames--; queuedBytes -= size })
    })
    client.on("close", () => { closed = true; sockets.delete(client); upstream?.terminate() })
    client.on("error", () => { closed = true; upstream?.terminate() })
  })
  return { issueTicket, dispose() {
    options.server.off("upgrade", upgrade)
    tickets.clear()
    for (const client of sockets) client.terminate()
    wss.close()
  } }
}
