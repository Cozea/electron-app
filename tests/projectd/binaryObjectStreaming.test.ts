import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { SessionBinaryObjectStore } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import { CHUNK_SIZE_BYTES } from "../../apps/projectd/src/collaboration/BinaryContentCache"

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function fixtureFetch(options: { failSecondPutOnce?: boolean } = {}) {
  const objects = new Map<string, Buffer>()
  const puts = new Map<string, number>()
  let failed = false
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "PUT") {
      puts.set(url, (puts.get(url) ?? 0) + 1)
      const body = Buffer.from(init.body as ArrayBuffer)
      if (options.failSecondPutOnce && !failed && objects.size === 1) {
        failed = true
        return new Response("temporary", { status: 503 })
      }
      if (objects.has(url)) return new Response(null, { status: 412 })
      objects.set(url, body)
      return new Response(null, { status: 201 })
    }
    if (init?.method === "GET") {
      const body = objects.get(url)
      return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 })
    }
    return new Response(null, { status: 405 })
  }) as unknown as typeof fetch
  return { fetchFn, objects, puts }
}

function store(fetchFn: typeof fetch) {
  return new SessionBinaryObjectStore({
    sessionId: "czs_0123456789abcdef",
    roomKey: Buffer.alloc(32, 7),
    getRoomUrl: () => "wss://collab.example/collab/sessions/room",
    getToken: async () => "ticket",
    fetchFn,
  })
}

describe("streaming binary object upload", () => {
  it("reads and uploads a large source only in fixed-size chunks", async () => {
    const bytes = Buffer.alloc(CHUNK_SIZE_BYTES * 2 + 17)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    const network = fixtureFetch()
    const objectStore = store(network.fetchFn)
    const reads: Array<{ offset: number; length: number }> = []

    const manifest = await objectStore.uploadFrom({
      size: bytes.length,
      contentHash: hash(bytes),
      read: async (offset, length) => {
        reads.push({ offset, length })
        return bytes.subarray(offset, offset + length)
      },
    })

    expect(reads).toEqual([
      { offset: 0, length: CHUNK_SIZE_BYTES },
      { offset: CHUNK_SIZE_BYTES, length: CHUNK_SIZE_BYTES },
      { offset: CHUNK_SIZE_BYTES * 2, length: 17 },
    ])
    expect(manifest.chunks).toHaveLength(3)
    expect(Math.max(...reads.map((read) => read.length))).toBe(CHUNK_SIZE_BYTES)

    const downloaded: Buffer[] = []
    await objectStore.downloadTo(manifest, async (chunk) => { downloaded.push(chunk) })
    expect(Buffer.concat(downloaded)).toEqual(bytes)
  })

  it("reuses a verified immutable chunk after an interrupted upload", async () => {
    const bytes = Buffer.alloc(CHUNK_SIZE_BYTES + 31, 9)
    const network = fixtureFetch({ failSecondPutOnce: true })
    const objectStore = store(network.fetchFn)
    const source = {
      size: bytes.length,
      contentHash: hash(bytes),
      read: async (offset: number, length: number) => bytes.subarray(offset, offset + length),
    }

    await expect(objectStore.uploadFrom(source)).rejects.toMatchObject({ code: "UPLOAD_FAILED" })
    expect(network.objects.size).toBe(1)

    const manifest = await objectStore.uploadFrom(source)
    expect(manifest.chunks).toHaveLength(2)
    expect(network.objects.size).toBe(2)
    const firstUrl = [...network.puts.keys()].find((url) => url.includes("/0/"))
    expect(firstUrl).toBeTruthy()
    expect(network.puts.get(firstUrl!)).toBe(2)
    expect(network.fetchFn.mock.calls.some(([input, init]) => String(input) === firstUrl && init?.method === "GET")).toBe(true)
    expect(await objectStore.download(manifest)).toEqual(bytes)
  })

  it("refuses a source that changes after its stable hash was recorded", async () => {
    const original = Buffer.alloc(CHUNK_SIZE_BYTES + 1, 1)
    const changed = Buffer.from(original)
    changed[changed.length - 1] = 2
    const network = fixtureFetch()
    const objectStore = store(network.fetchFn)
    await expect(objectStore.uploadFrom({
      size: changed.length,
      contentHash: hash(original),
      read: async (offset, length) => changed.subarray(offset, offset + length),
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })
})
