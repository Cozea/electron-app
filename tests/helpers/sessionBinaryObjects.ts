import { SessionBinaryObjectStore } from "../../apps/projectd/src/collaboration/BinaryObjectStore"

/** Real encryption/manifest client with an isolated HTTP object boundary. */
export function sessionBinaryObjects(sessionId: string, roomKey: Buffer, objects: Map<string, Uint8Array>) {
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer())
      if (!objects.has(request.url)) objects.set(request.url, bytes)
      return new Response(null, { status: 204 })
    }
    const bytes = objects.get(request.url)
    return bytes
      ? new Response(bytes.slice().buffer as ArrayBuffer)
      : new Response(null, { status: 404 })
  }
  return new SessionBinaryObjectStore({
    sessionId,
    roomKey,
    getRoomUrl: () => "ws://room.test/collab/sessions/ws",
    getToken: async () => "test-ticket",
    fetchFn,
  })
}
