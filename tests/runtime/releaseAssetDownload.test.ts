import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { downloadReleaseAsset } from "../../apps/desktop/electron/runtime/releaseAssetDownload"

const roots: string[] = []

function destination(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-asset-"))
  roots.push(root)
  return path.join(root, "nested", "asset.json")
}

function streamOf(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    async pull(controller) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (index >= chunks.length) controller.close()
      else controller.enqueue(encoder.encode(chunks[index++]))
    },
  })
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("downloadReleaseAsset", () => {
  it("writes the body to disk", async () => {
    const target = destination()
    const fetchFn = vi.fn(async () => new Response(streamOf(["{\"a\":", "1}"])))
    await downloadReleaseAsset("https://github.com/o/r/releases/download/v1/a.json", target, {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(fs.readFileSync(target, "utf8")).toBe("{\"a\":1}")
  })

  it("sends the token to GitHub but drops it once a redirect leaves GitHub", async () => {
    const target = destination()
    const seen: Array<{ host: string; authorization: string | undefined; redirect: string | undefined }> = []
    const fetchFn = vi.fn(async (input: URL, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      seen.push({ host: input.hostname, authorization: headers.authorization, redirect: init.redirect })
      return input.hostname === "github.com"
        ? redirect("https://objects.githubusercontent.com/asset?sig=x")
        : new Response(streamOf(["ok"]))
    })
    await downloadReleaseAsset("https://github.com/o/r/releases/download/v1/a.json", target, {
      token: "secret-token",
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(seen).toEqual([
      { host: "github.com", authorization: "Bearer secret-token", redirect: "manual" },
      { host: "objects.githubusercontent.com", authorization: undefined, redirect: "manual" },
    ])
  })

  it("refuses a redirect to plain HTTP", async () => {
    const fetchFn = vi.fn(async () => redirect("http://example.test/asset"))
    await expect(
      downloadReleaseAsset("https://github.com/a", destination(), { fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/non-HTTPS/)
  })

  it("stops following an endless redirect chain", async () => {
    const fetchFn = vi.fn(async () => redirect("https://github.com/again"))
    await expect(
      downloadReleaseAsset("https://github.com/a", destination(), { fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/redirected too far/)
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })

  it("reports a failed status without the URL or token", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 }))
    const failure = downloadReleaseAsset("https://github.com/a?x=1", destination(), {
      token: "secret-token",
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    await expect(failure).rejects.toThrow("Download failed (404)")
    await failure.catch((error: Error) => expect(error.message).not.toContain("secret-token"))
  })

  it("aborts a download that stops delivering bytes", async () => {
    const fetchFn = vi.fn(async (_input: URL, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"))
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason))
        },
      })
      return new Response(body)
    })
    await expect(
      downloadReleaseAsset("https://github.com/a", destination(), {
        stallTimeoutMs: 50,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/stalled/)
  })

  it("keeps a slow download alive as long as bytes keep arriving", async () => {
    const target = destination()
    // Eight 100ms gaps: twice the stall window in total, a quarter of it per
    // gap. The margin is wide on purpose; a loaded test run stretches timers.
    const fetchFn = vi.fn(async () => new Response(streamOf(["a", "b", "c", "d", "e", "f", "g"], 100)))
    await downloadReleaseAsset("https://github.com/a", target, {
      stallTimeoutMs: 400,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(fs.readFileSync(target, "utf8")).toBe("abcdefg")
  })

  it("refuses an asset larger than the ceiling", async () => {
    const fetchFn = vi.fn(async () => new Response(streamOf(["12345", "67890"])))
    await expect(
      downloadReleaseAsset("https://github.com/a", destination(), {
        maxBytes: 8,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exceeded 8 bytes/)
  })
})
