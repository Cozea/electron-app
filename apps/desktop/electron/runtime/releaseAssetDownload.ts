import fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Long enough for a slow link to deliver its next chunk, short enough that a
 * connection nobody is answering on does not hold a refresh open forever.
 */
const DEFAULT_STALL_TIMEOUT_MS = 30_000
/** Catalogs and signatures are kilobytes; this bounds a wrong or hostile asset. */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const MAX_REDIRECTS = 5
/** The only hosts a GitHub token is meant for. Release CDNs are not among them. */
const TOKEN_HOSTS = new Set(['github.com', 'api.github.com'])

export interface ReleaseAssetDownloadOptions {
  readonly token?: string
  readonly userAgent?: string
  readonly stallTimeoutMs?: number
  readonly maxBytes?: number
  /** Injected in tests. */
  readonly fetchFn?: typeof fetch
}

/**
 * Downloads a release asset to disk.
 *
 * Differs from `requestGitHubJson` on purpose. Release assets redirect to a
 * CDN, so redirects are followed — by hand, so the bearer token is dropped the
 * moment a hop leaves GitHub. And the deadline is a stall timeout, re-armed on
 * every chunk: a wall clock would abort a large artifact that is still arriving.
 */
export async function downloadReleaseAsset(
  url: string,
  destinationPath: string,
  options: ReleaseAssetDownloadOptions = {},
): Promise<void> {
  const call = options.fetchFn ?? fetch
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(
      () => controller.abort(new Error(`Download stalled for ${stallTimeoutMs}ms`)),
      stallTimeoutMs,
    )
  }

  try {
    arm()
    let current = new URL(url)
    let response: Response
    for (let hop = 0; ; hop += 1) {
      if (current.protocol !== 'https:') throw new Error('Refusing a non-HTTPS download')
      const headers: Record<string, string> = { accept: 'application/octet-stream' }
      if (options.userAgent) headers['user-agent'] = options.userAgent
      if (options.token && TOKEN_HOSTS.has(current.hostname)) {
        headers.authorization = `Bearer ${options.token}`
      }
      response = await call(current, { headers, redirect: 'manual', signal: controller.signal })
      if (response.status < 300 || response.status >= 400) break

      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location || hop >= MAX_REDIRECTS) throw new Error('Download redirected too far')
      current = new URL(location, current)
      arm()
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Download failed (${response.status})`)
    }

    await mkdir(path.dirname(destinationPath), { recursive: true })
    let received = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength
        if (received > maxBytes) {
          callback(new Error(`Download exceeded ${maxBytes} bytes`))
          return
        }
        arm()
        callback(null, chunk)
      },
    })
    // response.body is a DOM ReadableStream (lib.dom); Readable.fromWeb wants node's web stream type.
    const body = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream)
    await pipeline(body, meter, fs.createWriteStream(destinationPath), { signal: controller.signal })
  } catch (error) {
    // Whichever stage notices the abort first reports a generic "aborted"; the
    // reason says it was a stall.
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
  }
}
