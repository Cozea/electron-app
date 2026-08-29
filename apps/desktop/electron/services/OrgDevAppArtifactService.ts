import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { net, protocol } from "electron"
import { pathToFileURL } from "node:url"

import {
  buildOrgDevAppUrl,
  isContentHash,
  normalizeContentHash,
  normalizeEntryPath,
  ORG_DEVAPP_SCHEME,
  parseOrgDevAppUrl,
} from "../../../../shared/orgDevAppProtocol"
import {
  hashBuffer,
  ORG_DEVAPP_ARTIFACT_LIMITS,
  packDirectoryToZip,
  unpackZip,
} from "./orgDevAppZip"

const STATIC_OUTPUT_CANDIDATES = ["dist", "build", "out", "output", ".output/public"] as const
const DEVAPP_CACHE_MAX_BYTES = 512 * 1024 * 1024
const DEVAPP_CACHE_MAX_RELEASES = 24
const DEVAPP_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000
const MIME_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
}

export interface OrgDevAppBuildResult {
  zip: Uint8Array
  contentHash: string
  entryPath: string
  framework: string
  outputDir: string
}

export interface OrgDevAppPrepareResult {
  contentHash: string
  entryPath: string
  originUrl: string
  cacheDir: string
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function detectFrameworkLabel(projectRoot: string): string {
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const deps = {
    ...(typeof pkg?.dependencies === "object" && pkg.dependencies ? pkg.dependencies : {}),
    ...(typeof pkg?.devDependencies === "object" && pkg.devDependencies ? pkg.devDependencies : {}),
  } as Record<string, unknown>
  if ("next" in deps) return "nextjs"
  if ("nuxt" in deps) return "nuxt"
  if ("astro" in deps) return "astro"
  if ("@remix-run/react" in deps || "react-router" in deps) return "remix"
  if ("vite" in deps && "vue" in deps) return "vite-vue"
  if ("vite" in deps && "svelte" in deps) return "vite-svelte"
  if ("vite" in deps) return "vite-react"
  if ("gatsby" in deps) return "gatsby"
  return "web"
}

function detectBuildCommand(projectRoot: string): string {
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const scripts =
    pkg?.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts)
      ? (pkg.scripts as Record<string, unknown>)
      : {}
  if (typeof scripts.build === "string" && scripts.build.trim()) {
    if (fs.existsSync(path.join(projectRoot, "bun.lock")) || fs.existsSync(path.join(projectRoot, "bun.lockb"))) {
      return "bun run build"
    }
    if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
      return "pnpm run build"
    }
    if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) {
      return "yarn build"
    }
    return "npm run build"
  }
  throw new Error(
    "This project has no build script. Org DevApps publish a static UI, not a localhost preview. Add a package.json build script that writes index.html.",
  )
}

function findStaticOutput(projectRoot: string): { outputDir: string; entryPath: string } {
  for (const candidate of STATIC_OUTPUT_CANDIDATES) {
    const outputDir = path.join(projectRoot, candidate)
    const indexPath = path.join(outputDir, "index.html")
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return { outputDir, entryPath: "index.html" }
    }
  }
  throw new Error(
    "The build did not produce a static UI (no index.html in dist/, build/, or out/). Org DevApps cannot ship a localhost preview to the organization.",
  )
}

function terminateChildProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return
  const pid = child.pid
  try {
    if (process.platform === "win32") child.kill("SIGTERM")
    else process.kill(-pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode !== null) return
    try {
      if (process.platform === "win32") child.kill("SIGKILL")
      else process.kill(-pid, "SIGKILL")
    } catch {
      // The process already exited between the status check and signal.
    }
  }, 2_000)
  forceTimer.unref()
}

function runCommand(
  command: string,
  cwd: string,
  onChild: (child: ChildProcess | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      env: { ...process.env, CI: "1", NODE_ENV: "production" },
    })
    onChild(child)
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      onChild(null)
      reject(error)
    })
    child.on("close", (code) => {
      onChild(null)
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.trim().slice(-4000)
      reject(
        new Error(
          detail
            ? `The project build failed:\n${detail}`
            : `The project build failed with exit code ${code ?? "unknown"}.`,
        ),
      )
    })
  })
}

function mimeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

function resolveCachedFile(cacheDir: string, assetPath: string, entryPath: string): string | null {
  const requested = path.normalize(path.join(cacheDir, assetPath))
  const root = path.resolve(cacheDir) + path.sep
  if (!requested.startsWith(root) && path.resolve(requested) !== path.resolve(cacheDir)) {
    return null
  }
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return requested
  }
  const fallback = path.join(cacheDir, entryPath)
  if (fs.existsSync(fallback) && fs.statSync(fallback).isFile()) {
    return fallback
  }
  return null
}

function directorySize(rootDir: string): number {
  if (!fs.existsSync(rootDir)) return 0
  let total = 0
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(entryPath)
      else if (entry.isFile()) total += fs.statSync(entryPath).size
    }
  }
  return total
}

export class OrgDevAppArtifactService {
  private protocolRegistered = false
  private readonly getCacheRoot: () => string
  private readonly activeBuilds = new Map<string, ChildProcess>()
  private readonly cancelledBuilds = new Set<string>()
  private readonly pendingArtifacts = new Map<string, Promise<OrgDevAppPrepareResult>>()

  constructor(getCacheRoot: () => string) {
    this.getCacheRoot = getCacheRoot
  }

  getCacheDir(contentHash: string): string {
    return path.join(this.getCacheRoot(), normalizeContentHash(contentHash))
  }

  private touchReadyMarker(cacheDir: string): void {
    const marker = path.join(cacheDir, ".cozea-ready")
    const now = new Date()
    fs.utimesSync(marker, now, now)
  }

  private pruneCache(protectedHash?: string): void {
    const root = this.getCacheRoot()
    if (!fs.existsSync(root)) return
    const now = Date.now()
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(".staging-")) continue
      const stagingPath = path.join(root, entry.name)
      if (now - fs.statSync(stagingPath).mtimeMs > 60 * 60_000) {
        fs.rmSync(stagingPath, { recursive: true, force: true })
      }
    }
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isContentHash(entry.name))
      .map((entry) => {
        const cacheDir = path.join(root, entry.name)
        const marker = path.join(cacheDir, ".cozea-ready")
        const lastUsedAt = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0
        return { contentHash: entry.name, cacheDir, lastUsedAt, size: directorySize(cacheDir) }
      })
      .sort((left, right) => {
        if (left.contentHash === protectedHash) return -1
        if (right.contentHash === protectedHash) return 1
        return right.lastUsedAt - left.lastUsedAt
      })

    let retainedBytes = 0
    let retainedCount = 0
    for (const entry of entries) {
      const expired = now - entry.lastUsedAt > DEVAPP_CACHE_MAX_AGE_MS
      const overQuota =
        retainedCount >= DEVAPP_CACHE_MAX_RELEASES ||
        retainedBytes + entry.size > DEVAPP_CACHE_MAX_BYTES
      if (entry.contentHash !== protectedHash && (expired || overQuota)) {
        fs.rmSync(entry.cacheDir, { recursive: true, force: true })
        continue
      }
      retainedCount += 1
      retainedBytes += entry.size
    }
  }

  cancelBuild(operationId: string): boolean {
    const child = this.activeBuilds.get(operationId)
    if (!child) return false
    this.cancelledBuilds.add(operationId)
    terminateChildProcess(child)
    return true
  }

  dispose(): void {
    for (const [operationId, child] of this.activeBuilds) {
      this.cancelledBuilds.add(operationId)
      terminateChildProcess(child)
    }
    this.activeBuilds.clear()
  }

  async buildAndPack(
    projectRoot: string,
    options: { operationId?: string } = {},
  ): Promise<OrgDevAppBuildResult> {
    const resolvedRoot = path.resolve(projectRoot)
    if (!fs.existsSync(path.join(resolvedRoot, "package.json"))) {
      throw new Error("This folder is not a Node project, so Cozea cannot build a static DevApp from it.")
    }

    const framework = detectFrameworkLabel(resolvedRoot)
    const buildCommand = detectBuildCommand(resolvedRoot)
    const operationId = options.operationId
    try {
      await runCommand(buildCommand, resolvedRoot, (child) => {
        if (!operationId) return
        if (child) this.activeBuilds.set(operationId, child)
        else this.activeBuilds.delete(operationId)
      })
    } catch (error) {
      if (operationId && this.cancelledBuilds.delete(operationId)) {
        throw new Error("Publishing was cancelled.")
      }
      throw error
    }
    if (operationId) this.cancelledBuilds.delete(operationId)
    const { outputDir, entryPath } = findStaticOutput(resolvedRoot)
    const packed = packDirectoryToZip(outputDir)
    return {
      zip: packed.zip,
      contentHash: packed.contentHash,
      entryPath,
      framework,
      outputDir,
    }
  }

  async prepareArtifact(input: {
    downloadUrl: string
    contentHash: string
    entryPath?: string
  }): Promise<OrgDevAppPrepareResult> {
    const contentHash = normalizeContentHash(input.contentHash)
    if (!isContentHash(contentHash)) {
      throw new Error("The DevApp artifact hash is invalid.")
    }
    const pending = this.pendingArtifacts.get(contentHash)
    if (pending) return await pending
    const preparation = this.prepareArtifactOnce({ ...input, contentHash })
    this.pendingArtifacts.set(contentHash, preparation)
    try {
      return await preparation
    } finally {
      if (this.pendingArtifacts.get(contentHash) === preparation) {
        this.pendingArtifacts.delete(contentHash)
      }
    }
  }

  private async prepareArtifactOnce(input: {
    downloadUrl: string
    contentHash: string
    entryPath?: string
  }): Promise<OrgDevAppPrepareResult> {
    const contentHash = input.contentHash
    const entryPath = normalizeEntryPath(input.entryPath)
    const cacheDir = this.getCacheDir(contentHash)
    const readyMarker = path.join(cacheDir, ".cozea-ready")
    const entryFile = path.join(cacheDir, entryPath)
    if (fs.existsSync(readyMarker) && fs.existsSync(entryFile)) {
      this.touchReadyMarker(cacheDir)
      this.pruneCache(contentHash)
      return {
        contentHash,
        entryPath,
        originUrl: buildOrgDevAppUrl({ contentHash, entryPath }),
        cacheDir,
      }
    }

    const response = await net.fetch(input.downloadUrl)
    if (!response.ok) {
      throw new Error(`Cozea could not download the DevApp artifact (${response.status}).`)
    }
    const declaredLength = Number(response.headers.get("content-length"))
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes
    ) {
      throw new Error("The published DevApp artifact exceeds the download limit.")
    }
    const zip = Buffer.from(await response.arrayBuffer())
    if (zip.length > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes) {
      throw new Error("The published DevApp artifact exceeds the download limit.")
    }
    if (hashBuffer(zip) !== contentHash) {
      throw new Error("The downloaded DevApp artifact did not match its published hash.")
    }

    const cacheRoot = this.getCacheRoot()
    fs.mkdirSync(cacheRoot, { recursive: true })
    const staging = fs.mkdtempSync(path.join(cacheRoot, ".staging-"))
    try {
      unpackZip(zip, staging)
      if (!fs.existsSync(path.join(staging, entryPath))) {
        throw new Error("The DevApp artifact is missing its entry HTML file.")
      }
      fs.rmSync(cacheDir, { recursive: true, force: true })
      fs.renameSync(staging, cacheDir)
      fs.writeFileSync(readyMarker, contentHash, "utf8")
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true })
    }

    if (!fs.existsSync(path.join(cacheDir, entryPath))) {
      throw new Error("The DevApp artifact is missing its entry HTML file.")
    }

    this.pruneCache(contentHash)
    return {
      contentHash,
      entryPath,
      originUrl: buildOrgDevAppUrl({ contentHash, entryPath }),
      cacheDir,
    }
  }

  registerProtocol(): void {
    if (this.protocolRegistered) return
    protocol.handle(ORG_DEVAPP_SCHEME, async (request) => {
      const parsed = parseOrgDevAppUrl(request.url)
      if (!parsed) {
        return new Response("Invalid DevApp URL", {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      const cacheDir = this.getCacheDir(parsed.contentHash)
      const filePath = resolveCachedFile(cacheDir, parsed.assetPath, "index.html")
      if (!filePath) {
        return new Response("DevApp file not found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }
      const fileUrl = pathToFileURL(filePath).toString()
      const fileResponse = await net.fetch(fileUrl)
      const headers = new Headers(fileResponse.headers)
      headers.set("content-type", mimeForPath(filePath))
      headers.set("cache-control", "public, max-age=31536000, immutable")
      headers.set(
        "content-security-policy",
        "default-src 'self' https: data: blob:; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; connect-src https: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'",
      )
      headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=()")
      headers.set("x-content-type-options", "nosniff")
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        headers,
      })
    })
    this.protocolRegistered = true
  }
}
