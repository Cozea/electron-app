import { afterEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import { once } from "node:events"
import { WebSocket, WebSocketServer } from "ws"
import { attachRendererRpcGateway } from "../../apps/server/src/t3/rendererRpcGateway"
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(authorizeRequest = vi.fn(async (_method: string, _payload: unknown) => {})) {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await once(upstream, "listening")
  const received: unknown[] = []
  upstream.on("connection", (ws) => ws.on("message", (raw) => { const frame = JSON.parse(raw.toString()); received.push(frame); ws.send(JSON.stringify({ forwarded: true })) }))
  const server = http.createServer()
  const gateway = attachRendererRpcGateway({ server, upstreamBaseUrl: `http://127.0.0.1:${(upstream.address() as import("node:net").AddressInfo).port}`, issueUpstreamTicket: async () => "upstream-private-ticket", authorizeRequest })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  cleanups.push(async () => { gateway.dispose(); for (const ws of upstream.clients) ws.terminate(); await new Promise<void>((resolve) => upstream.close(() => resolve())); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const ticket = await gateway.issueTicket()
  const address = `ws://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/ws?wsTicket=${ticket}`
  const client = new WebSocket(address)
  await once(client, "open")
  return { client, address, received, authorizeRequest }
}
describe("renderer T3 removal gateway", () => {
  it("forwards native requests with a separate one-use renderer ticket", async () => {
    const { client, address, received, authorizeRequest } = await fixture()
    const response = once(client, "message")
    client.send(JSON.stringify({ _tag: "Request", id: "0", tag: "server.getConfig", payload: {} }))
    await response
    expect(received).toHaveLength(1)
    expect(authorizeRequest).toHaveBeenCalledWith("server.getConfig", {})
    const replay = new WebSocket(address)
    const failed = new Promise<void>((resolve) => replay.once("error", () => resolve()))
    await failed
    replay.terminate()
  })
  it("rejects the whole mixed batch including request ID zero without forwarding any effect", async () => {
    const guard = vi.fn(async (method: string) => { if (method === "terminal.open") throw new Error("Workspace excluded") })
    const { client, received } = await fixture(guard)
    const responses: unknown[] = []
    const done = new Promise<void>((resolve) => client.on("message", (raw) => { responses.push(JSON.parse(raw.toString())); if (responses.length === 2) resolve() }))
    client.send(JSON.stringify([{ jsonrpc: "2.0", id: 0, method: "terminal.open", params: { cwd: "/source" } }, { jsonrpc: "2.0", id: 1, method: "server.getConfig", params: {} }]))
    await done
    expect(received).toEqual([])
    expect(responses).toEqual([expect.objectContaining({ id: 0, error: expect.objectContaining({ message: "Workspace excluded" }) }), expect.objectContaining({ id: 1 })])
  })
})
