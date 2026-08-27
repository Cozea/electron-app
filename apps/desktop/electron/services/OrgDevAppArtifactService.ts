import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
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
import { hashBuffer, packDirectoryToZip, unpackZip } from "./orgDevAppZip"

const STATIC_OUTPUT_CANDIDATES = ["dist", "build", "out", "output", ".output/public"] as const
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

function runCommand(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: "1", NODE_ENV: "production" },
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      reject(error)
    })
    child.on("close", (code) => {
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

export class OrgDevAppArtifactService {
  private protocolRegistered = false
  private readonly getCacheRoot: () => string

  constructor(getCacheRoot: () => string) {
    this.getCacheRoot = getCacheRoot
  }

  getCacheDir(contentHash: string): string {
    return path.join(this.getCacheRoot(), normalizeContentHash(contentHash))
  }

  async buildAndPack(projectRoot: string): Promise<OrgDevAppBuildResult> {
    const resolvedRoot = path.resolve(projectRoot)
    if (!fs.existsSync(path.join(resolvedRoot, "package.json"))) {
      throw new Error("This folder is not a Node project, so Cozea cannot build a static DevApp from it.")
    }

    const framework = detectFrameworkLabel(resolvedRoot)
    const buildCommand = detectBuildCommand(resolvedRoot)
    await runCommand(buildCommand, resolvedRoot)
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
    const entryPath = normalizeEntryPath(input.entryPath)
    const cacheDir = this.getCacheDir(contentHash)
    const readyMarker = path.join(cacheDir, ".cozea-ready")
    const entryFile = path.join(cacheDir, entryPath)
    if (fs.existsSync(readyMarker) && fs.existsSync(entryFile)) {
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
    const zip = Buffer.from(await response.arrayBuffer())
    if (hashBuffer(zip) !== contentHash) {
      throw new Error("The downloaded DevApp artifact did not match its published hash.")
    }

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-devapp-"))
    try {
      unpackZip(zip, staging)
      fs.rmSync(cacheDir, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
      fs.cpSync(staging, cacheDir, { recursive: true })
      fs.writeFileSync(readyMarker, contentHash, "utf8")
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }

    if (!fs.existsSync(path.join(cacheDir, entryPath))) {
      throw new Error("The DevApp artifact is missing its entry HTML file.")
    }

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
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        headers,
      })
    })
    this.protocolRegistered = true
  }
}
