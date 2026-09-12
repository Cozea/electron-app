import path from "node:path"
import { expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { SessionBinaryObjectStore } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import { CHUNK_SIZE_BYTES } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import { loadSessionRoomWorker, sessionTokenFor, TEST_PUBLIC_SESSION_ID, TEST_ROOM_ENV } from "../helpers/sessionRoomHarness"

vi.mock("../../cloudflare/worker/src/lib/convex", () => ({
  validateSessionRoomPrincipalInConvex: async () => ({ keyVersion: 1 }),
}))

it("runs real encrypted uploads through the Worker and resumes without replacing stored chunks", async () => {
  const { handleSessionBinaryObject } = await import(/* @vite-ignore */ path.resolve(
    process.cwd(), "cloudflare/worker/src/routes/sessionBinary.ts")) as {
      handleSessionBinaryObject: (request: Request, env: object, sessionId: string, ref: string) => Promise<Response>
    }
  const worker = await loadSessionRoomWorker()
  const stored = new Map<string, Uint8Array>()
  let failNextChunk = true
  const env = {
    ...TEST_ROOM_ENV,
    COLLAB_BINARY_OBJECTS: {
      put: async (key: string, bytes: Uint8Array, options: { onlyIf: Headers }) => {
        expect(options.onlyIf.get("if-none-match")).toBe("*")
        if (stored.has(key)) return null
        stored.set(key, Uint8Array.from(bytes))
        return { key }
      },
      get: async (key: string) => {
        const body = stored.get(key)
        return body ? { size: body.length, body } : null
      },
    },
  }
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const ref = new URL(request.url).pathname.split(`/binary/${TEST_PUBLIC_SESSION_ID}/`)[1]
    if (init?.method === "PUT" && ref.split("/")[3] === "1" && failNextChunk) {
      failNextChunk = false
      return new Response(null, { status: 503 })
    }
    return handleSessionBinaryObject(request, env, TEST_PUBLIC_SESSION_ID, ref)
  }
  const token = await sessionTokenFor(worker, "principal_binary")()
  const options = {
    sessionId: TEST_PUBLIC_SESSION_ID, roomKey: randomBytes(32), fetchFn,
    getRoomUrl: () => "wss://room.example/collab/sessions/ws", getToken: async () => token,
  }
  const bytes = randomBytes(CHUNK_SIZE_BYTES + 1024)
  await expect(new SessionBinaryObjectStore(options).upload(bytes)).rejects.toThrow(/503/)
  expect(stored.size).toBe(1)
  const firstCiphertext = Buffer.from([...stored.values()][0])
  const restarted = new SessionBinaryObjectStore(options)
  const manifest = await restarted.upload(bytes)
  expect(stored.size).toBe(2)
  // Compare multi-megabyte ciphertext byte-for-byte without the assertion
  // library walking millions of individual indexed properties.
  expect(Buffer.from([...stored.values()][0]).equals(firstCiphertext)).toBe(true)
  expect((await restarted.download(manifest)).equals(bytes)).toBe(true)
  const recoveryToken = await sessionTokenFor(worker, "principal_binary", { sessionAccess: "recovery" })()
  const recovery = new SessionBinaryObjectStore({ ...options, getToken: async () => recoveryToken })
  expect((await recovery.download(manifest)).equals(bytes)).toBe(true)
  await expect(recovery.upload(randomBytes(32))).rejects.toThrow(/403/)
  expect(stored.size).toBe(2)
  const first = [...stored.values()][0]
  first[0] ^= 1
  await expect(restarted.upload(bytes)).rejects.toThrow(/authenticated/)
})
