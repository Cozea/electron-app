import fs from "node:fs"
import { timingSafeEqual } from "node:crypto"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

interface RuntimeEnvelope {
  channel: "host" | "view"
  connectionId?: string
  message?: unknown
  close?: boolean
}

interface WorkerRuntimeTransport {
  onHostMessage(listener: (message: unknown) => void): () => void
  onViewMessage(listener: (connectionId: string, message: unknown, close: boolean) => void): () => void
  sendHost(message: unknown): void
  sendView(connectionId: string, message: unknown): void
}

const protocolWrite = process.stdout.write.bind(process.stdout)
// Package logging belongs on stderr. Stdout is the private helper protocol and cannot safely
// contain arbitrary application output.
process.stdout.write = ((chunk: Uint8Array | string) => process.stderr.write(chunk)) as typeof process.stdout.write

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
const HOSTED_EVENT_LIMIT = 512
const HOSTED_LONG_POLL_MS = 20_000
const hostedSecret = process.env.COZEA_DEVAPP_HOSTED_TRANSPORT_SECRET?.trim() ?? ""
const hostedPort = Number(process.env.COZEA_DEVAPP_HOSTED_TRANSPORT_PORT ?? "8787")
const hostedServiceSecret = process.env.COZEA_DEVAPP_HOSTED_SERVICE_SECRET?.trim() ?? ""
const hostedServicePort = Number(process.env.COZEA_DEVAPP_HOSTED_SERVICE_PORT ?? "0")
const hostedEvents: Array<{ cursor: number; envelope: RuntimeEnvelope }> = []
const hostedWaiters = new Set<() => void>()
let hostedCursor = 0

function send(envelope: RuntimeEnvelope): void {
  const payload = JSON.stringify(envelope)
  if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) {
    throw new Error("The DevApp runtime message exceeds 2 MB.")
  }
  if (!hostedSecret) {
    protocolWrite(`${payload}\n`)
    return
  }
  hostedCursor += 1
  hostedEvents.push({ cursor: hostedCursor, envelope })
  if (hostedEvents.length > HOSTED_EVENT_LIMIT) hostedEvents.shift()
  for (const wake of hostedWaiters) wake()
  hostedWaiters.clear()
}

const hostListeners = new Set<(message: unknown) => void>()
const viewListeners = new Set<(connectionId: string, message: unknown, close: boolean) => void>()
const transport: WorkerRuntimeTransport = {
  onHostMessage: (listener) => {
    hostListeners.add(listener)
    return () => hostListeners.delete(listener)
  },
  onViewMessage: (listener) => {
    viewListeners.add(listener)
    return () => viewListeners.delete(listener)
  },
  sendHost: (message) => send({ channel: "host", message }),
  sendView: (connectionId, message) => send({ channel: "view", connectionId, message }),
}
;(
  globalThis as typeof globalThis & { __cozeaDevAppWorkerTransport?: WorkerRuntimeTransport }
).__cozeaDevAppWorkerTransport = transport

let input = ""
function dispatch(envelope: RuntimeEnvelope): void {
  if (envelope.channel === "host") {
    for (const listener of hostListeners) listener(envelope.message)
    return
  }
  if (
    envelope.channel === "view" &&
    typeof envelope.connectionId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(envelope.connectionId)
  ) {
    for (const listener of viewListeners) {
      listener(envelope.connectionId, envelope.message, envelope.close === true)
    }
  }
}

function startStdinTransport(): void {
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string) => {
    input += chunk
    if (Buffer.byteLength(input) > MAX_MESSAGE_BYTES && !input.includes("\n")) {
      throw new Error("The DevApp runtime input exceeds 2 MB.")
    }
    let newline = input.indexOf("\n")
    while (newline >= 0) {
      const line = input.slice(0, newline)
      input = input.slice(newline + 1)
      if (line.trim()) {
        const envelope = JSON.parse(line) as RuntimeEnvelope
        dispatch(envelope)
      }
      newline = input.indexOf("\n")
    }
  })
}

function secretMatches(provided: string, secret: string): boolean {
  const expected = Buffer.from(secret)
  const actual = Buffer.from(provided)
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual)
}

function authorized(request: IncomingMessage): boolean {
  return secretMatches(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "", hostedSecret)
}

function serviceAuthorized(request: IncomingMessage): boolean {
  const provided = request.headers["x-cozea-hosted-service-token"]
  return secretMatches(Array.isArray(provided) ? (provided[0] ?? "") : (provided ?? ""), hostedServiceSecret)
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function serviceHeaders(headers: IncomingHttpHeaders, upgrade: boolean): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === "host" || lower === "x-cozea-hosted-service-token") continue
    if (!upgrade && HOP_BY_HOP.has(lower)) continue
    result[name] = value
  }
  result.host = `127.0.0.1:${hostedServicePort}`
  return result
}

function proxyServiceRequest(request: IncomingMessage, response: ServerResponse): void {
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: hostedServicePort,
      method: request.method,
      path: request.url ?? "/",
      headers: serviceHeaders(request.headers, false),
    },
    (upstreamResponse) => {
      const headers = Object.fromEntries(
        Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())),
      )
      headers["x-content-type-options"] = "nosniff"
      response.writeHead(upstreamResponse.statusCode ?? 502, headers)
      upstreamResponse.pipe(response)
    },
  )
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    }
    response.end("Hosted DevApp service unavailable")
  })
  request.pipe(upstream)
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end(JSON.stringify(value))
}

async function readEnvelope(request: IncomingMessage): Promise<RuntimeEnvelope> {
  const declared = Number(request.headers["content-length"] ?? "0")
  if (Number.isFinite(declared) && declared > MAX_MESSAGE_BYTES) {
    throw new Error("The DevApp runtime input exceeds 2 MB.")
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_MESSAGE_BYTES) throw new Error("The DevApp runtime input exceeds 2 MB.")
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RuntimeEnvelope
  if (
    !value ||
    (value.channel !== "host" && value.channel !== "view") ||
    (value.channel === "view" &&
      (typeof value.connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.connectionId)))
  ) {
    throw new Error("The DevApp runtime transport envelope is invalid.")
  }
  return value
}

async function waitForHostedEvents(cursor: number): Promise<void> {
  if (hostedCursor > cursor) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      hostedWaiters.delete(wake)
      resolve()
    }, HOSTED_LONG_POLL_MS)
    const wake = () => {
      clearTimeout(timer)
      resolve()
    }
    hostedWaiters.add(wake)
  })
}

async function startHostedTransport(): Promise<void> {
  if (!hostedSecret) {
    startStdinTransport()
    return
  }
  if (hostedSecret.length < 32 || hostedSecret.length > 256) {
    throw new Error("The hosted DevApp transport secret is invalid.")
  }
  if (!Number.isInteger(hostedPort) || hostedPort < 1024 || hostedPort > 65535) {
    throw new Error("The hosted DevApp transport port is invalid.")
  }
  if (
    (hostedServiceSecret &&
      (hostedServiceSecret.length < 32 ||
        hostedServiceSecret.length > 256 ||
        !Number.isInteger(hostedServicePort) ||
        hostedServicePort < 1024 ||
        hostedServicePort > 65535)) ||
    (!hostedServiceSecret && hostedServicePort !== 0)
  ) {
    throw new Error("The hosted DevApp service proxy is invalid.")
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`)
      if (request.method === "GET" && url.pathname === "/__cozea/health") {
        json(response, 200, { ready: true })
        return
      }
      if (request.method === "POST" && url.pathname === "/v1/message") {
        if (!authorized(request)) {
          json(response, 401, { error: "Unauthorized" })
          return
        }
        dispatch(await readEnvelope(request))
        json(response, 202, { accepted: true })
        return
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        if (!authorized(request)) {
          json(response, 401, { error: "Unauthorized" })
          return
        }
        const cursor = Number(url.searchParams.get("cursor") ?? "0")
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > hostedCursor) {
          json(response, 400, { error: "The event cursor is invalid." })
          return
        }
        const first = hostedEvents[0]?.cursor ?? hostedCursor + 1
        if (cursor > 0 && cursor + 1 < first) {
          json(response, 409, { error: "The event cursor expired.", cursor: hostedCursor })
          return
        }
        await waitForHostedEvents(cursor)
        json(response, 200, {
          cursor: hostedCursor,
          events: hostedEvents.filter((entry) => entry.cursor > cursor),
        })
        return
      }
      if (hostedServiceSecret) {
        if (!serviceAuthorized(request)) {
          json(response, 401, { error: "Unauthorized" })
          return
        }
        proxyServiceRequest(request, response)
        return
      }
      json(response, 404, { error: "Not found" })
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" })
    }
  })
  server.on("upgrade", (request, socket, head) => {
    if (!hostedServiceSecret || !serviceAuthorized(request)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
      return
    }
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: hostedServicePort,
      method: request.method,
      path: request.url ?? "/",
      headers: serviceHeaders(request.headers, true),
    })
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      const status = upstreamResponse.statusCode ?? 101
      const statusMessage = upstreamResponse.statusMessage ?? "Switching Protocols"
      const headerLines: string[] = []
      for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
        headerLines.push(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}`)
      }
      socket.write(`HTTP/1.1 ${status} ${statusMessage}\r\n${headerLines.join("\r\n")}\r\n\r\n`)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      socket.pipe(upstreamSocket).pipe(socket)
    })
    upstream.on("response", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"))
    upstream.on("error", () => socket.destroy())
    upstream.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(hostedPort, "0.0.0.0", resolve)
  })
}

function packageEntry(packageRoot: string, relative: unknown, label: string): string | null {
  if (relative === undefined) return null
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.includes("\0")) {
    throw new Error(`${label} is invalid.`)
  }
  const candidate = path.resolve(packageRoot, relative)
  if (candidate !== packageRoot && !candidate.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the immutable package.`)
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`${label} is missing from the immutable package.`)
  }
  return candidate
}

async function main(): Promise<void> {
  await startHostedTransport()
  const packageRoot = "/cozea/package"
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "cozea-devapp.json"), "utf8")) as {
    worker?: { entry?: unknown }
    service?: { runtimeKind?: unknown; entry?: unknown }
  }
  const worker = packageEntry(packageRoot, manifest.worker?.entry, "worker.entry")
  const service =
    manifest.service?.runtimeKind === "node" ? packageEntry(packageRoot, manifest.service.entry, "service.entry") : null
  if (worker) await import(pathToFileURL(worker).href)
  if (service) await import(pathToFileURL(service).href)
  send({
    channel: "host",
    message: { kind: "event", protocolVersion: 1, topic: "runtime.ready", payload: null },
  })
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
