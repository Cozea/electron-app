import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from "node:http"
import { request as httpsRequest } from "node:https"
import { connect as connectSocket } from "node:net"
import { connect as connectTlsSocket } from "node:tls"
import os from "node:os"
import path from "node:path"
import { net, protocol, safeStorage, type Session } from "electron"
import { pathToFileURL } from "node:url"

import {
  buildOrgDevAppUrl,
  buildOrgDevAppServiceUrl,
  isContentHash,
  normalizeContentHash,
  normalizeEntryPath,
  ORG_DEVAPP_SCHEME,
  parseOrgDevAppUrl,
} from "../../../../shared/orgDevAppProtocol"
import { hashBuffer, packDirectoryToZip, unpackZip } from "./orgDevAppZip"
import { orgDevAppArtifactLimits } from "../../../../shared/orgDevAppLimits"
import { uploadPackedDevApp } from "./orgDevAppUpload"
import { preflightProject } from "./orgDevAppPreflight"
import {
  parseServiceDevAppManifest,
  serviceDevAppPermissionSetHash,
  type OrgDevAppRuntimeKind,
  type ServiceDevAppManifest,
} from "../../../../shared/serviceDevAppManifest"
import type { OrgDevAppRuntimeState } from "../../../../shared/orgDevAppRuntime"
import type { OrgDevAppEnvironmentStatus } from "../../../../shared/orgDevAppEnvironment"
import type { DevAppContainedRuntimeState, DevAppFolderGrant } from "../../../../shared/devAppContainedRuntime"
import { DEV_APP_MANIFEST_FILENAME, parseDevAppPackage, type DevAppPackage } from "../../../../shared/devAppPackage"

export type { OrgDevAppRuntimeState } from "../../../../shared/orgDevAppRuntime"

const STATIC_OUTPUT_CANDIDATES = ["dist", "build", "out", "output", ".output/public"] as const
const DEVAPP_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024
const DEVAPP_CACHE_MAX_RELEASES = 48
const DEVAPP_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000
const DEVAPP_GATEWAY_MAX_REQUEST_BYTES = 16 * 1024 * 1024
const DEVAPP_RUNTIME_IDLE_TIMEOUT_MS = 5 * 60_000
const DEVAPP_GATEWAY_TOKEN_HEADER = "x-cozea-devapp-gateway"
const HOSTED_SERVICE_TOKEN_HEADER = "x-cozea-hosted-service-token"
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])
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
  runtimeKind: OrgDevAppRuntimeKind
  manifestVersion?: number
  platform?: string
  arch?: string
  permissionSetHash?: string
}

export interface OrgDevAppBuildAndUploadResult {
  storageId: string
  contentHash: string
  entryPath: string
  framework: string
  runtimeKind: OrgDevAppRuntimeKind
  manifestVersion?: number
  platform?: string
  arch?: string
  permissionSetHash?: string
}

export interface OrgDevAppPrepareResult {
  contentHash: string
  entryPath: string
  originUrl: string
  cacheDir: string
  runtimeKind: OrgDevAppRuntimeKind
  manifest?: ServiceDevAppManifest
}

interface ActiveServiceRuntime {
  runtimeId: string
  state: OrgDevAppRuntimeState
  targetUrl: URL
  targetServiceToken: string | null
  leases: Set<string>
  idleTimer: NodeJS.Timeout | null
}

export interface OrgDevAppContainedServiceAdapter {
  start(options: {
    ref: string
    workspaceId: string
    workspaceRoot: string
    leaseId: string
    gatewayBaseUrl: string
    accessToken: string
    environment: Record<string, string>
    folderGrants: DevAppFolderGrant[]
  }): Promise<{
    key: string
    state: { status: string; guestAddress: string | null; servicePort: number | null; error: string | null }
    serviceUrl: string | null
    serviceToken: string | null
    logs: string[]
  }>
  stop(runtimeId: string): Promise<void>
  release(runtimeId: string, leaseId: string): boolean
  runtimeState(runtimeId: string): DevAppContainedRuntimeState | null
}

interface StoredServiceTrust {
  version: 1
  approvals: string[]
  configurations: Record<string, Record<string, string>>
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
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

interface BuildInvocation {
  command: string
  args: string[]
}

function detectBuildCommand(projectRoot: string): BuildInvocation {
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const scripts =
    pkg?.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts)
      ? (pkg.scripts as Record<string, unknown>)
      : {}
  if (typeof scripts.build === "string" && scripts.build.trim()) {
    if (fs.existsSync(path.join(projectRoot, "bun.lock")) || fs.existsSync(path.join(projectRoot, "bun.lockb"))) {
      return { command: "bun", args: ["run", "build"] }
    }
    if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) {
      return { command: "pnpm", args: ["run", "build"] }
    }
    if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) {
      return { command: "yarn", args: ["build"] }
    }
    return { command: "npm", args: ["run", "build"] }
  }
  throw new Error(
    "This project has no build script. Org DevApps publish a production artifact, not a localhost preview. Add a package.json build script that produces a static UI or portable service output.",
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
    "The build did not produce a static UI or a configured portable service output. Org DevApps cannot ship a localhost development command to the organization.",
  )
}

interface PublisherServiceConfig extends Pick<ServiceDevAppManifest, "environment" | "permissions"> {
  service: {
    entrypoint: string
    args: string[]
    hostEnv: string
    portEnv: string
    healthPath: string
    startupTimeoutMs: number
  }
}

function readAuthoredPackage(projectRoot: string): DevAppPackage | null {
  const manifestPath = path.join(projectRoot, DEV_APP_MANIFEST_FILENAME)
  if (!fs.existsSync(manifestPath)) return null
  const parsed = parseDevAppPackage(fs.readFileSync(manifestPath, "utf8"))
  if (!parsed.manifest) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
  }
  return parsed.manifest
}

function publishedServicePermissions(manifest: DevAppPackage): ServiceDevAppManifest["permissions"] {
  if (manifest.service?.runtimeKind !== "node" || !manifest.runtime) {
    throw new Error(
      "Published Service DevApps require a v2 cozea-devapp.json with a Node service and explicit runtime placement.",
    )
  }
  return {
    // A Service DevApp must bind its private ingress port. This permission also discloses
    // that the contained service may make outbound requests.
    network: true,
    persistentData: manifest.runtime.state !== "none",
  }
}

function readPublisherServiceConfig(projectRoot: string): PublisherServiceConfig {
  const authored = readAuthoredPackage(projectRoot)
  if (!authored) {
    throw new Error("Published Service DevApps require cozea-devapp.json so runtime placement and state are explicit.")
  }
  const declaredPermissions = publishedServicePermissions(authored)
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const config = pkg?.cozeaDevApp
  if (config === undefined) {
    return {
      environment: [],
      permissions: declaredPermissions,
      service: {
        entrypoint: authored.service!.entry!,
        args: [],
        hostEnv: "HOSTNAME",
        portEnv: "PORT",
        healthPath: "/",
        startupTimeoutMs: 30_000,
      },
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("package.json cozeaDevApp must be an object.")
  const record = config as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== "environment" && key !== "service")
      throw new Error(`package.json cozeaDevApp contains unsupported field ${key}.`)
  }
  const environment = record.environment ?? []
  const checked = parseServiceDevAppManifest({
    schemaVersion: 2,
    kind: "service",
    platform: "linux",
    arch: "multi",
    framework: "configuration-check",
    runtime: { kind: "node", entrypoint: "server.js", args: [] },
    server: { hostEnv: "HOSTNAME", portEnv: "PORT", healthPath: "/", startupTimeoutMs: 30_000 },
    environment,
    permissions: declaredPermissions,
  })
  if (record.service === undefined) {
    return {
      environment: checked.environment,
      permissions: checked.permissions,
      service: {
        entrypoint: authored.service!.entry!,
        args: [],
        hostEnv: "HOSTNAME",
        portEnv: "PORT",
        healthPath: "/",
        startupTimeoutMs: 30_000,
      },
    }
  }
  if (!record.service || typeof record.service !== "object" || Array.isArray(record.service))
    throw new Error("package.json cozeaDevApp.service must be an object.")
  const service = record.service as Record<string, unknown>
  const allowedServiceKeys = new Set(["args", "hostEnv", "portEnv", "healthPath", "startupTimeoutMs"])
  for (const key of Object.keys(service)) {
    if (!allowedServiceKeys.has(key))
      throw new Error(`package.json cozeaDevApp.service contains unsupported field ${key}.`)
  }
  const serviceManifest = parseServiceDevAppManifest({
    ...checked,
    framework: "generic-node",
    runtime: { kind: "node", entrypoint: authored.service!.entry!, args: service.args ?? [] },
    server: {
      hostEnv: service.hostEnv ?? "HOSTNAME",
      portEnv: service.portEnv ?? "PORT",
      healthPath: service.healthPath ?? "/",
      startupTimeoutMs: service.startupTimeoutMs ?? 30_000,
    },
  })
  return {
    environment: serviceManifest.environment,
    permissions: serviceManifest.permissions,
    service: {
      entrypoint: serviceManifest.runtime.entrypoint,
      args: serviceManifest.runtime.args,
      hostEnv: serviceManifest.server.hostEnv,
      portEnv: serviceManifest.server.portEnv,
      healthPath: serviceManifest.server.healthPath,
      startupTimeoutMs: serviceManifest.server.startupTimeoutMs,
    },
  }
}

function writeServiceMetadataEntry(stagingRoot: string, entrypoint: string): void {
  const entryFile = path.join(stagingRoot, entrypoint)
  fs.mkdirSync(path.dirname(entryFile), { recursive: true })
  // The release artifact is the immutable UI/configuration record. Executable bytes come
  // exclusively from the signed multi-platform image produced by the central builder.
  // Keeping only a marker prevents a publisher-host build from becoming a second runtime.
  fs.writeFileSync(entryFile, "Contained runtime entry; executable bytes are in the signed image.\n")
}

function stageExecutableOnlyView(manifest: DevAppPackage): string {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-worker-view-"))
  const title = manifest.name.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  )
  fs.writeFileSync(
    path.join(stagingRoot, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark light"><title>${title}</title>` +
      `<style>body{font:14px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#ddd}` +
      `main{max-width:34rem;padding:2rem}h1{font-size:1.15rem}p{line-height:1.5;color:#aaa}</style>` +
      `<main><h1>${title}</h1><p>This DevApp runs as a contained background worker. Use the tile controls to approve, monitor, and stop it.</p></main>`,
    "utf8",
  )
  return stagingRoot
}

function stageContainedService(
  projectRoot: string,
  framework: string,
): { outputDir: string; manifest: ServiceDevAppManifest } {
  const publisherConfig = readPublisherServiceConfig(projectRoot)
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-service-"))
  const entrypoint = `server/${publisherConfig.service.entrypoint}`
  const sourceEntry = path.join(projectRoot, publisherConfig.service.entrypoint)
  if (!fs.existsSync(sourceEntry) || !fs.statSync(sourceEntry).isFile()) {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    throw new Error(`The Service DevApp entrypoint ${publisherConfig.service.entrypoint} is missing after the build.`)
  }
  const manifest = parseServiceDevAppManifest({
    schemaVersion: 2,
    kind: "service",
    platform: "linux",
    arch: "multi",
    framework,
    runtime: { kind: "node", entrypoint, args: publisherConfig.service.args },
    server: {
      hostEnv: publisherConfig.service.hostEnv,
      portEnv: publisherConfig.service.portEnv,
      healthPath: publisherConfig.service.healthPath,
      startupTimeoutMs: publisherConfig.service.startupTimeoutMs,
    },
    environment: publisherConfig.environment,
    permissions: publisherConfig.permissions,
  })
  writeServiceMetadataEntry(stagingRoot, entrypoint)
  fs.writeFileSync(path.join(stagingRoot, "cozea-devapp.json"), JSON.stringify(manifest, null, 2))
  return { outputDir: stagingRoot, manifest }
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
  invocation: BuildInvocation,
  cwd: string,
  onChild: (child: ChildProcess | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      detached: process.platform !== "win32",
      env: { ...process.env, CI: "1", NODE_ENV: "production" },
    })
    onChild(child)
    let stderr = ""
    let stdout = ""
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    // Next and Vite write build diagnostics to stdout, so stderr alone leaves a failed
    // build reported as a bare exit code with no explanation attached.
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString()
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
      const detail = (stderr.trim() || stdout.trim()).slice(-4000)
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

function makeArtifactReadOnly(rootDir: string): void {
  const directories: string[] = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    directories.push(current)
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(entryPath)
      else if (entry.isFile()) fs.chmodSync(entryPath, 0o444)
    }
  }
  for (const directory of directories.reverse()) fs.chmodSync(directory, 0o555)
}

function removeCachedArtifact(rootDir: string): void {
  if (!fs.existsSync(rootDir)) return
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    try {
      fs.chmodSync(current, 0o755)
    } catch {
      /* Best-effort recovery before removal. */
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(entryPath)
      else {
        try {
          fs.chmodSync(entryPath, 0o644)
        } catch {
          /* Best-effort recovery before removal. */
        }
      }
    }
  }
  fs.rmSync(rootDir, { recursive: true, force: true })
}

export class OrgDevAppArtifactService {
  private protocolRegistered = false
  private readonly registeredSessionProtocols = new WeakSet<Session>()
  private readonly getCacheRoot: () => string
  private readonly activeBuilds = new Map<string, ChildProcess>()
  private readonly activeUploads = new Map<string, AbortController>()
  private readonly cancelledBuilds = new Set<string>()
  private readonly pendingArtifacts = new Map<string, Promise<OrgDevAppPrepareResult>>()
  private readonly activeServiceRuntimes = new Map<string, ActiveServiceRuntime>()
  private readonly gatewayPublications = new Map<string, string>()
  private gatewayServer: HttpServer | null = null
  private gatewayPort: number | null = null
  private protectedContentHashes: () => ReadonlySet<string> = () => new Set()
  private containedServiceAdapter: OrgDevAppContainedServiceAdapter | null = null

  constructor(getCacheRoot: () => string) {
    this.getCacheRoot = getCacheRoot
  }

  setProtectedContentHashes(provider: () => ReadonlySet<string>): void {
    this.protectedContentHashes = provider
  }

  setContainedServiceAdapter(adapter: OrgDevAppContainedServiceAdapter): void {
    this.containedServiceAdapter = adapter
  }

  getPreparedArtifactSize(contentHash: string): number {
    return directorySize(this.getCacheDir(contentHash))
  }

  removePreparedArtifact(contentHashInput: string): void {
    const contentHash = normalizeContentHash(contentHashInput)
    if (!isContentHash(contentHash)) throw new Error("The DevApp artifact hash is invalid.")
    const active = [...this.activeServiceRuntimes.keys()].some((key) => key.endsWith(`:${contentHash}`))
    if (active) throw new Error("The DevApp is still running.")
    removeCachedArtifact(this.getCacheDir(contentHash))
  }

  private runtimeKey(contentHash: string, publicationId: string): string {
    return `${publicationId}:${contentHash}`
  }

  private trustKey(contentHashInput: string, publicationIdInput: string, permissionSetHashInput: string): string {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput.trim()
    const permissionSetHash = normalizeContentHash(permissionSetHashInput)
    if (!isContentHash(contentHash) || !isContentHash(permissionSetHash))
      throw new Error("The DevApp trust metadata is invalid.")
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicationId)) throw new Error("The DevApp publication ID is invalid.")
    return `${publicationId}:${contentHash}:${permissionSetHash}`
  }

  private trustFilePath(): string {
    return path.join(this.getCacheRoot(), ".service-trust")
  }

  private readTrust(): StoredServiceTrust {
    const trustPath = this.trustFilePath()
    if (!fs.existsSync(trustPath)) return { version: 1, approvals: [], configurations: {} }
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("macOS secure storage is unavailable, so Service DevApp trust cannot be verified.")
    const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(trustPath)))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("The Service DevApp trust store is invalid.")
    const approvals = (parsed as { approvals?: unknown }).approvals
    if (!Array.isArray(approvals) || approvals.some((entry) => typeof entry !== "string")) {
      throw new Error("The Service DevApp trust store is invalid.")
    }
    const configurationsValue = (parsed as { configurations?: unknown }).configurations
    const configurations: Record<string, Record<string, string>> = {}
    if (configurationsValue && typeof configurationsValue === "object" && !Array.isArray(configurationsValue)) {
      for (const [publicationId, values] of Object.entries(configurationsValue)) {
        if (!values || typeof values !== "object" || Array.isArray(values)) continue
        const safeValues = Object.fromEntries(
          Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
        configurations[publicationId] = safeValues
      }
    }
    return { version: 1, approvals: [...new Set(approvals)], configurations }
  }

  private writeTrust(trust: StoredServiceTrust): void {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("macOS secure storage is unavailable, so Service DevApp trust cannot be saved.")
    const root = this.getCacheRoot()
    fs.mkdirSync(root, { recursive: true })
    const trustPath = this.trustFilePath()
    const temporary = `${trustPath}.tmp`
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(trust)), { mode: 0o600 })
    fs.renameSync(temporary, trustPath)
  }

  isRuntimeTrusted(contentHash: string, publicationId: string, permissionSetHash: string): boolean {
    return this.readTrust().approvals.includes(this.trustKey(contentHash, publicationId, permissionSetHash))
  }

  approveRuntime(contentHash: string, publicationId: string, permissionSetHash: string): void {
    const key = this.trustKey(contentHash, publicationId, permissionSetHash)
    const cacheDir = this.getCacheDir(contentHash)
    const manifest = parseServiceDevAppManifest(
      JSON.parse(fs.readFileSync(path.join(cacheDir, "cozea-devapp.json"), "utf8")),
    )
    if (serviceDevAppPermissionSetHash(manifest) !== normalizeContentHash(permissionSetHash)) {
      throw new Error("The Service DevApp permissions do not match the published release.")
    }
    const trust = this.readTrust()
    if (!trust.approvals.includes(key)) this.writeTrust({ ...trust, approvals: [...trust.approvals, key] })
  }

  getRuntimeEnvironmentStatus(contentHashInput: string, publicationIdInput: string): OrgDevAppEnvironmentStatus {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput.trim()
    if (!isContentHash(contentHash) || !/^[A-Za-z0-9_-]{1,128}$/.test(publicationId))
      throw new Error("The DevApp configuration target is invalid.")
    const manifest = parseServiceDevAppManifest(
      JSON.parse(fs.readFileSync(path.join(this.getCacheDir(contentHash), "cozea-devapp.json"), "utf8")),
    )
    const configured = this.readTrust().configurations[publicationId] ?? {}
    const requirements = manifest.environment.map((entry) => ({
      ...entry,
      configured: typeof configured[entry.name] === "string" && configured[entry.name].length > 0,
    }))
    return {
      requirements,
      missingRequired: requirements.filter((entry) => entry.required && !entry.configured).map((entry) => entry.name),
    }
  }

  setRuntimeEnvironment(
    contentHashInput: string,
    publicationIdInput: string,
    values: Record<string, string | null>,
  ): OrgDevAppEnvironmentStatus {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput.trim()
    if (!isContentHash(contentHash) || !/^[A-Za-z0-9_-]{1,128}$/.test(publicationId))
      throw new Error("The DevApp configuration target is invalid.")
    const manifest = parseServiceDevAppManifest(
      JSON.parse(fs.readFileSync(path.join(this.getCacheDir(contentHash), "cozea-devapp.json"), "utf8")),
    )
    const allowedNames = new Set(manifest.environment.map((entry) => entry.name))
    const trust = this.readTrust()
    const next = { ...trust.configurations[publicationId] }
    for (const [name, value] of Object.entries(values)) {
      if (!allowedNames.has(name)) throw new Error(`The Service DevApp does not declare ${name}.`)
      if (value === null || value === "") delete next[name]
      else {
        if (typeof value !== "string" || value.length > 16_384 || /\0/.test(value))
          throw new Error(`${name} is too large or invalid.`)
        next[name] = value
      }
    }
    this.writeTrust({
      ...trust,
      configurations: { ...trust.configurations, [publicationId]: next },
    })
    return this.getRuntimeEnvironmentStatus(contentHash, publicationId)
  }

  removePublicationTrust(publicationIdInput: string): void {
    const publicationId = publicationIdInput.trim()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicationId)) {
      throw new Error("The DevApp publication ID is invalid.")
    }
    const trust = this.readTrust()
    const approvals = trust.approvals.filter((entry) => !entry.startsWith(`${publicationId}:`))
    const configurations = { ...trust.configurations }
    delete configurations[publicationId]
    if (
      approvals.length !== trust.approvals.length ||
      Object.keys(configurations).length !== Object.keys(trust.configurations).length
    ) {
      this.writeTrust({ version: 1, approvals, configurations })
    }
  }

  getCacheDir(contentHash: string): string {
    return path.join(this.getCacheRoot(), normalizeContentHash(contentHash))
  }

  private resolveGatewayRuntime(hostHeader: string | undefined, gatewayToken: string): ActiveServiceRuntime | null {
    if (!hostHeader || this.gatewayPort === null) return null
    let parsed: URL
    try {
      parsed = new URL(`http://${hostHeader}`)
    } catch {
      return null
    }
    if (Number(parsed.port) !== this.gatewayPort) return null
    const suffix = ".service.localhost"
    const hostname = parsed.hostname.toLowerCase()
    if (!hostname.endsWith(suffix)) return null
    const contentHash = normalizeContentHash(hostname.slice(0, -suffix.length))
    if (!isContentHash(contentHash)) return null
    const publicationId = this.gatewayPublications.get(gatewayToken)
    if (!publicationId) return null
    const runtimeKey = this.runtimeKey(contentHash, publicationId)
    const runtime = this.activeServiceRuntimes.get(runtimeKey)
    if (!runtime || !this.reconcileContainedRuntime(runtimeKey, runtime)) return null
    return runtime.state.status === "ready" ? runtime : null
  }

  private reconcileContainedRuntime(runtimeKey: string, runtime: ActiveServiceRuntime): boolean {
    const contained = this.containedServiceAdapter?.runtimeState(runtime.runtimeId)
    if (contained?.status === "running") return true
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer)
    runtime.idleTimer = null
    runtime.state = {
      ...runtime.state,
      status: contained?.status === "failed" ? "failed" : "stopped",
      originUrl: null,
      error: contained?.error ?? null,
    }
    this.activeServiceRuntimes.delete(runtimeKey)
    return false
  }

  private gatewayAccessToken(headers: NodeJS.Dict<string | string[] | undefined>): string | null {
    const value = headers[DEVAPP_GATEWAY_TOKEN_HEADER]
    const token = Array.isArray(value) ? value[0] : value
    return typeof token === "string" && this.gatewayPublications.has(token) ? token : null
  }

  private async ensureGateway(): Promise<number> {
    if (this.gatewayServer && this.gatewayPort !== null) return this.gatewayPort
    const server = createHttpServer((request, response) => {
      const gatewayToken = this.gatewayAccessToken(request.headers)
      if (!gatewayToken) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
        response.end("DevApp gateway access denied")
        return
      }
      const runtime = this.resolveGatewayRuntime(request.headers.host, gatewayToken)
      if (!runtime) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        response.end("DevApp runtime not found")
        return
      }
      const contentLength = Number(request.headers["content-length"])
      if (Number.isFinite(contentLength) && contentLength > DEVAPP_GATEWAY_MAX_REQUEST_BYTES) {
        response.writeHead(413, { "content-type": "text/plain; charset=utf-8" })
        response.end("DevApp request is too large")
        return
      }
      let received = 0
      request.on("data", (chunk: Buffer) => {
        received += chunk.length
        if (received > DEVAPP_GATEWAY_MAX_REQUEST_BYTES) request.destroy(new Error("DevApp request is too large"))
      })
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) =>
            name.toLowerCase() !== DEVAPP_GATEWAY_TOKEN_HEADER &&
            name.toLowerCase() !== HOSTED_SERVICE_TOKEN_HEADER &&
            !HOP_BY_HOP_HEADERS.has(name.toLowerCase()),
        ),
      )
      headers.host = runtime.targetUrl.host
      if (runtime.targetServiceToken) {
        headers[HOSTED_SERVICE_TOKEN_HEADER] = runtime.targetServiceToken
      }
      const targetPath = new URL(request.url ?? "/", runtime.targetUrl)
      const requestUpstream = runtime.targetUrl.protocol === "https:" ? httpsRequest : httpRequest
      const upstream = requestUpstream(
        {
          hostname: runtime.targetUrl.hostname,
          port: runtime.targetUrl.port || undefined,
          method: request.method,
          path: `${targetPath.pathname}${targetPath.search}`,
          headers,
        },
        (upstreamResponse) => {
          const responseHeaders = Object.fromEntries(
            Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase())),
          )
          responseHeaders["x-content-type-options"] = "nosniff"
          responseHeaders["permissions-policy"] =
            "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=()"
          response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
          upstreamResponse.pipe(response)
        },
      )
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
        response.end("DevApp service unavailable")
      })
      request.pipe(upstream)
    })
    server.on("upgrade", (request, socket, head) => {
      const gatewayToken = this.gatewayAccessToken(request.headers)
      if (!gatewayToken) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
        return
      }
      const runtime = this.resolveGatewayRuntime(request.headers.host, gatewayToken)
      if (!runtime) {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
        return
      }
      const targetPort = Number(runtime.targetUrl.port || (runtime.targetUrl.protocol === "https:" ? 443 : 80))
      const onConnect = () => {
        const headerLines = Object.entries(request.headers)
          .filter(
            ([name]) =>
              name.toLowerCase() !== DEVAPP_GATEWAY_TOKEN_HEADER && name.toLowerCase() !== HOSTED_SERVICE_TOKEN_HEADER,
          )
          .map(
            ([name, value]) =>
              `${name}: ${name.toLowerCase() === "host" ? runtime.targetUrl.host : Array.isArray(value) ? value.join(", ") : (value ?? "")}`,
          )
        if (runtime.targetServiceToken) {
          headerLines.push(`${HOSTED_SERVICE_TOKEN_HEADER}: ${runtime.targetServiceToken}`)
        }
        upstream.write(
          `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n${headerLines.join("\r\n")}\r\n\r\n`,
        )
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      }
      const upstream =
        runtime.targetUrl.protocol === "https:"
          ? connectTlsSocket(
              {
                host: runtime.targetUrl.hostname,
                port: targetPort,
                servername: runtime.targetUrl.hostname,
              },
              onConnect,
            )
          : connectSocket(targetPort, runtime.targetUrl.hostname, onConnect)
      upstream.on("error", () => socket.destroy())
    })
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        const assigned = typeof address === "object" && address ? address.port : 0
        if (!assigned) reject(new Error("The DevApp gateway could not allocate a port."))
        else resolve(assigned)
      })
    })
    this.gatewayServer = server
    this.gatewayPort = port
    return port
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
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
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
    const activeHashes = new Set(
      [...this.activeServiceRuntimes.keys()].map((key) => key.slice(key.lastIndexOf(":") + 1)),
    )
    const installedHashes = this.protectedContentHashes()
    for (const entry of entries) {
      const expired = now - entry.lastUsedAt > DEVAPP_CACHE_MAX_AGE_MS
      const overQuota =
        retainedCount >= DEVAPP_CACHE_MAX_RELEASES || retainedBytes + entry.size > DEVAPP_CACHE_MAX_BYTES
      if (
        entry.contentHash !== protectedHash &&
        !activeHashes.has(entry.contentHash) &&
        !installedHashes.has(entry.contentHash) &&
        (expired || overQuota)
      ) {
        removeCachedArtifact(entry.cacheDir)
        continue
      }
      retainedCount += 1
      retainedBytes += entry.size
    }
  }

  cancelBuild(operationId: string): boolean {
    const child = this.activeBuilds.get(operationId)
    const upload = this.activeUploads.get(operationId)
    if (!child && !upload) return false
    this.cancelledBuilds.add(operationId)
    if (child) terminateChildProcess(child)
    upload?.abort()
    return true
  }

  dispose(): void {
    for (const [operationId, child] of this.activeBuilds) {
      this.cancelledBuilds.add(operationId)
      terminateChildProcess(child)
    }
    this.activeBuilds.clear()
    for (const upload of this.activeUploads.values()) upload.abort()
    this.activeUploads.clear()
    for (const runtime of this.activeServiceRuntimes.values()) {
      void this.containedServiceAdapter?.stop(runtime.runtimeId)
    }
    this.activeServiceRuntimes.clear()
    this.gatewayPublications.clear()
    this.gatewayServer?.close()
    this.gatewayServer = null
    this.gatewayPort = null
  }

  async buildAndUpload(
    projectRoot: string,
    uploadUrl: string,
    options: { operationId?: string } = {},
  ): Promise<OrgDevAppBuildAndUploadResult> {
    const controller = new AbortController()
    const operationId = options.operationId
    if (operationId) this.activeUploads.set(operationId, controller)
    try {
      const packed = await this.buildAndPack(projectRoot, options)
      if (controller.signal.aborted) throw new Error("Publishing was cancelled.")
      const uploaded = await uploadPackedDevApp(uploadUrl, packed, {
        signal: controller.signal,
      })
      return {
        storageId: uploaded.storageId,
        contentHash: packed.contentHash,
        entryPath: packed.entryPath,
        framework: packed.framework,
        runtimeKind: packed.runtimeKind,
        ...(packed.manifestVersion ? { manifestVersion: packed.manifestVersion } : {}),
        ...(packed.platform ? { platform: packed.platform } : {}),
        ...(packed.arch ? { arch: packed.arch } : {}),
        ...(packed.permissionSetHash ? { permissionSetHash: packed.permissionSetHash } : {}),
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Publishing was cancelled.")
      throw error
    } finally {
      if (operationId) {
        this.activeUploads.delete(operationId)
        this.cancelledBuilds.delete(operationId)
      }
    }
  }

  async buildAndPack(projectRoot: string, options: { operationId?: string } = {}): Promise<OrgDevAppBuildResult> {
    const resolvedRoot = path.resolve(projectRoot)
    const authoredPackage = readAuthoredPackage(resolvedRoot)

    // Report everything statically knowable before spending minutes on a build. Without
    // this a project with three faults costs three builds to discover them.
    const preflight = preflightProject(resolvedRoot)
    const blocking = preflight.diagnostics.filter((diagnostic) => diagnostic.severity === "blocker")
    if (blocking.length > 0) {
      const detail = blocking
        .map((diagnostic) => `- ${diagnostic.message}${diagnostic.fix ? ` ${diagnostic.fix}` : ""}`)
        .join("\n")
      throw new Error(`This project cannot be published as a DevApp yet:\n${detail}`)
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
    let staticError: unknown = new Error("This package declares a Node service.")
    if (authoredPackage?.service?.runtimeKind !== "node") {
      try {
        const { outputDir, entryPath } = findStaticOutput(resolvedRoot)
        const packed = packDirectoryToZip(outputDir)
        return {
          zip: packed.zip,
          contentHash: packed.contentHash,
          entryPath,
          framework,
          outputDir,
          runtimeKind: "static",
        }
      } catch (error) {
        staticError = error
      }
      if (authoredPackage?.worker && !authoredPackage.view) {
        const outputDir = stageExecutableOnlyView(authoredPackage)
        try {
          const packed = packDirectoryToZip(outputDir)
          return {
            zip: packed.zip,
            contentHash: packed.contentHash,
            entryPath: "index.html",
            framework,
            outputDir,
            runtimeKind: "static",
          }
        } finally {
          fs.rmSync(outputDir, { recursive: true, force: true })
        }
      }
    }
    {
      if (authoredPackage?.service?.runtimeKind !== "node") throw staticError
      const staged = stageContainedService(resolvedRoot, framework)
      try {
        const packed = packDirectoryToZip(staged.outputDir, orgDevAppArtifactLimits("service"))
        return {
          zip: packed.zip,
          contentHash: packed.contentHash,
          entryPath: staged.manifest.runtime.entrypoint,
          framework,
          outputDir: staged.outputDir,
          runtimeKind: "service",
          manifestVersion: staged.manifest.schemaVersion,
          platform: staged.manifest.platform,
          arch: staged.manifest.arch,
          permissionSetHash: serviceDevAppPermissionSetHash(staged.manifest),
        }
      } finally {
        fs.rmSync(staged.outputDir, { recursive: true, force: true })
      }
    }
  }

  async prepareArtifact(input: {
    downloadUrl: string
    contentHash: string
    entryPath?: string
    runtimeKind?: OrgDevAppRuntimeKind
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

  prepareCachedArtifact(input: {
    contentHash: string
    entryPath?: string
    runtimeKind?: OrgDevAppRuntimeKind
  }): OrgDevAppPrepareResult {
    const contentHash = normalizeContentHash(input.contentHash)
    if (!isContentHash(contentHash)) throw new Error("The DevApp artifact hash is invalid.")
    const entryPath = normalizeEntryPath(input.entryPath)
    const cacheDir = this.getCacheDir(contentHash)
    const readyMarker = path.join(cacheDir, ".cozea-ready")
    const isService = input.runtimeKind === "service"
    const requiredFile = isService ? path.join(cacheDir, "cozea-devapp.json") : path.join(cacheDir, entryPath)
    if (!fs.existsSync(readyMarker) || !fs.existsSync(requiredFile)) {
      throw new Error("This installed DevApp is missing from local storage. Reinstall it while online.")
    }
    const manifest = isService
      ? parseServiceDevAppManifest(JSON.parse(fs.readFileSync(requiredFile, "utf8")))
      : undefined
    this.touchReadyMarker(cacheDir)
    return {
      contentHash,
      entryPath,
      originUrl: buildOrgDevAppUrl({ contentHash, entryPath }),
      cacheDir,
      runtimeKind: isService ? "service" : "static",
      ...(manifest ? { manifest } : {}),
    }
  }

  private async prepareArtifactOnce(input: {
    downloadUrl: string
    contentHash: string
    entryPath?: string
    runtimeKind?: OrgDevAppRuntimeKind
  }): Promise<OrgDevAppPrepareResult> {
    const contentHash = input.contentHash
    const entryPath = normalizeEntryPath(input.entryPath)
    const cacheDir = this.getCacheDir(contentHash)
    const readyMarker = path.join(cacheDir, ".cozea-ready")
    const entryFile = path.join(cacheDir, entryPath)
    const manifestFile = path.join(cacheDir, "cozea-devapp.json")
    const isService = input.runtimeKind === "service"
    const artifactLimits = orgDevAppArtifactLimits(isService ? "service" : "static")
    if (fs.existsSync(readyMarker) && fs.existsSync(isService ? manifestFile : entryFile)) {
      const manifest = isService
        ? parseServiceDevAppManifest(JSON.parse(fs.readFileSync(manifestFile, "utf8")))
        : undefined
      this.touchReadyMarker(cacheDir)
      this.pruneCache(contentHash)
      return {
        contentHash,
        entryPath,
        originUrl: buildOrgDevAppUrl({ contentHash, entryPath }),
        cacheDir,
        runtimeKind: isService ? "service" : "static",
        ...(manifest ? { manifest } : {}),
      }
    }

    const response = await net.fetch(input.downloadUrl)
    if (!response.ok) {
      throw new Error(`Cozea could not download the DevApp artifact (${response.status}).`)
    }
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > artifactLimits.maxCompressedBytes) {
      throw new Error("The published DevApp artifact exceeds the download limit.")
    }
    const zip = Buffer.from(await response.arrayBuffer())
    if (zip.length > artifactLimits.maxCompressedBytes) {
      throw new Error("The published DevApp artifact exceeds the download limit.")
    }
    if (hashBuffer(zip) !== contentHash) {
      throw new Error("The downloaded DevApp artifact did not match its published hash.")
    }

    const cacheRoot = this.getCacheRoot()
    fs.mkdirSync(cacheRoot, { recursive: true })
    const staging = fs.mkdtempSync(path.join(cacheRoot, ".staging-"))
    try {
      unpackZip(zip, staging, artifactLimits)
      if (isService) {
        const extractedManifest = path.join(staging, "cozea-devapp.json")
        if (!fs.existsSync(extractedManifest)) throw new Error("The Service DevApp manifest is missing.")
        const manifest = parseServiceDevAppManifest(JSON.parse(fs.readFileSync(extractedManifest, "utf8")))
        if (!fs.existsSync(path.join(staging, manifest.runtime.entrypoint)))
          throw new Error("The Service DevApp entrypoint is missing.")
      } else if (!fs.existsSync(path.join(staging, entryPath))) {
        throw new Error("The DevApp artifact is missing its entry HTML file.")
      }
      removeCachedArtifact(cacheDir)
      fs.renameSync(staging, cacheDir)
      fs.writeFileSync(readyMarker, contentHash, "utf8")
      if (isService) makeArtifactReadOnly(cacheDir)
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true })
    }

    if (!isService && !fs.existsSync(path.join(cacheDir, entryPath))) {
      throw new Error("The DevApp artifact is missing its entry HTML file.")
    }

    this.pruneCache(contentHash)
    const manifest = isService
      ? parseServiceDevAppManifest(JSON.parse(fs.readFileSync(manifestFile, "utf8")))
      : undefined
    return {
      contentHash,
      entryPath,
      originUrl: buildOrgDevAppUrl({ contentHash, entryPath }),
      cacheDir,
      runtimeKind: isService ? "service" : "static",
      ...(manifest ? { manifest } : {}),
    }
  }

  getRuntimeState(contentHashInput: string, publicationIdInput?: string): OrgDevAppRuntimeState {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput?.trim()
    const runtimeKey =
      publicationId && /^[A-Za-z0-9_-]{1,128}$/.test(publicationId) ? this.runtimeKey(contentHash, publicationId) : null
    const runtime = runtimeKey ? this.activeServiceRuntimes.get(runtimeKey) : null
    if (runtime && !this.reconcileContainedRuntime(runtimeKey!, runtime)) return runtime.state
    return (
      runtime?.state ?? {
        contentHash,
        status: "stopped",
        originUrl: null,
        error: null,
        logs: [],
      }
    )
  }

  async startRuntime(options: {
    ref: string
    contentHash: string
    publicationId: string
    permissionSetHash: string
    leaseId: string
    workspaceId: string
    workspaceRoot: string
    gatewayBaseUrl: string
    accessToken: string
    folderGrants: DevAppFolderGrant[]
  }): Promise<OrgDevAppRuntimeState> {
    if (!this.containedServiceAdapter) {
      throw new Error("The contained Service DevApp runtime is unavailable.")
    }
    const contentHash = normalizeContentHash(options.contentHash)
    const cacheDir = this.getCacheDir(contentHash)
    const manifest = parseServiceDevAppManifest(
      JSON.parse(fs.readFileSync(path.join(cacheDir, "cozea-devapp.json"), "utf8")),
    )
    const publicationId = options.publicationId.trim()
    if (publicationId && !/^[A-Za-z0-9_-]{1,128}$/.test(publicationId))
      throw new Error("The DevApp publication ID is invalid.")
    if (!publicationId || !this.isRuntimeTrusted(contentHash, publicationId, options.permissionSetHash)) {
      throw new Error("Approve this Service DevApp release before starting it.")
    }
    const runtimeKey = this.runtimeKey(contentHash, publicationId)
    const existing = this.activeServiceRuntimes.get(runtimeKey)
    const leaseId = options.leaseId.trim()
    if (!leaseId || !/^[A-Za-z0-9_-]{1,160}$/.test(leaseId)) throw new Error("The DevApp runtime lease is invalid.")
    if (existing && existing.state.status === "ready") {
      existing.leases.add(leaseId)
      if (existing.idleTimer) clearTimeout(existing.idleTimer)
      existing.idleTimer = null
      return existing.state
    }
    const storedEnvironment = this.readTrust().configurations[publicationId] ?? {}
    const missingRequired = manifest.environment.filter((entry) => entry.required && !storedEnvironment[entry.name])
    if (missingRequired.length > 0)
      throw new Error(
        `Configure ${missingRequired.map((entry) => entry.name).join(", ")} before starting this Service DevApp.`,
      )
    const active = await this.containedServiceAdapter.start({
      ref: options.ref,
      workspaceId: options.workspaceId,
      workspaceRoot: options.workspaceRoot,
      leaseId,
      gatewayBaseUrl: options.gatewayBaseUrl,
      accessToken: options.accessToken,
      environment: Object.fromEntries(
        manifest.environment.flatMap((entry) => {
          const value = storedEnvironment[entry.name]
          return value === undefined ? [] : [[entry.name, value]]
        }),
      ),
      folderGrants: options.folderGrants,
    })
    const privateServiceUrl =
      active.serviceUrl ??
      (active.state.guestAddress && active.state.servicePort
        ? `http://${active.state.guestAddress}:${active.state.servicePort}`
        : null)
    if (!privateServiceUrl) {
      await this.containedServiceAdapter.stop(active.key)
      throw new Error("The contained Service DevApp exposed no private service endpoint.")
    }
    const targetUrl = new URL(privateServiceUrl)
    if (
      (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") ||
      (targetUrl.protocol === "http:" &&
        targetUrl.hostname !== "127.0.0.1" &&
        targetUrl.hostname !== active.state.guestAddress)
    ) {
      await this.containedServiceAdapter.stop(active.key)
      throw new Error("The contained Service DevApp exposed an invalid private service endpoint.")
    }
    const state: OrgDevAppRuntimeState = {
      contentHash,
      status: "starting",
      originUrl: null,
      error: null,
      logs: active.logs,
    }
    this.activeServiceRuntimes.set(runtimeKey, {
      runtimeId: active.key,
      state,
      targetUrl,
      targetServiceToken: active.serviceToken,
      leases: new Set([leaseId]),
      idleTimer: null,
    })
    const deadline = Date.now() + manifest.server.startupTimeoutMs
    while (Date.now() < deadline) {
      try {
        const response = await net.fetch(new URL(manifest.server.healthPath, targetUrl).toString(), {
          headers: active.serviceToken ? { [HOSTED_SERVICE_TOKEN_HEADER]: active.serviceToken } : undefined,
        })
        if (response.status >= 100) {
          const gatewayPort = await this.ensureGateway()
          state.status = "ready"
          state.originUrl = buildOrgDevAppServiceUrl(contentHash, gatewayPort)
          return state
        }
      } catch {
        // The server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    await this.containedServiceAdapter.stop(active.key)
    state.status = "failed"
    state.error = state.error ?? "The Service DevApp did not become ready in time."
    return state
  }

  async stopRuntime(contentHashInput: string, publicationIdInput?: string): Promise<OrgDevAppRuntimeState> {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput?.trim()
    if (!publicationId || !/^[A-Za-z0-9_-]{1,128}$/.test(publicationId))
      throw new Error("The DevApp publication ID is invalid.")
    const runtimeKey = this.runtimeKey(contentHash, publicationId)
    const runtime = this.activeServiceRuntimes.get(runtimeKey)
    if (runtime) {
      if (runtime.idleTimer) clearTimeout(runtime.idleTimer)
      await this.containedServiceAdapter?.stop(runtime.runtimeId)
      this.activeServiceRuntimes.delete(runtimeKey)
    }
    return {
      contentHash,
      status: "stopped",
      originUrl: null,
      error: null,
      logs: runtime?.state.logs ?? [],
    }
  }

  releaseRuntime(contentHashInput: string, publicationIdInput: string, leaseIdInput: string): boolean {
    const contentHash = normalizeContentHash(contentHashInput)
    const publicationId = publicationIdInput.trim()
    const leaseId = leaseIdInput.trim()
    if (
      !isContentHash(contentHash) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(publicationId) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(leaseId)
    )
      return false
    const runtimeKey = this.runtimeKey(contentHash, publicationId)
    const runtime = this.activeServiceRuntimes.get(runtimeKey)
    if (!runtime) return false
    runtime.leases.delete(leaseId)
    if (runtime.leases.size === 0 && !runtime.idleTimer) {
      runtime.idleTimer = setTimeout(() => {
        const current = this.activeServiceRuntimes.get(runtimeKey)
        if (!current || current.leases.size > 0) return
        void this.containedServiceAdapter?.stop(current.runtimeId)
        this.activeServiceRuntimes.delete(runtimeKey)
      }, DEVAPP_RUNTIME_IDLE_TIMEOUT_MS)
      runtime.idleTimer.unref()
    }
    return true
  }

  private readonly handleProtocolRequest = async (request: Request): Promise<Response> => {
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
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=()",
    )
    headers.set("x-content-type-options", "nosniff")
    return new Response(fileResponse.body, {
      status: fileResponse.status,
      headers,
    })
  }

  registerProtocol(): void {
    if (this.protocolRegistered) return
    protocol.handle(ORG_DEVAPP_SCHEME, this.handleProtocolRequest)
    this.protocolRegistered = true
  }

  registerProtocolForSession(targetSession: Session, partitionKey: string): void {
    if (this.registeredSessionProtocols.has(targetSession)) return
    const publicationId = partitionKey.trim()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicationId)) throw new Error("The DevApp session key is invalid.")
    const gatewayToken = randomBytes(32).toString("hex")
    this.gatewayPublications.set(gatewayToken, publicationId)
    targetSession.protocol.handle(ORG_DEVAPP_SCHEME, this.handleProtocolRequest)
    targetSession.webRequest.onBeforeSendHeaders(
      { urls: ["http://*.service.localhost:*/*", "ws://*.service.localhost:*/*"] },
      (details, callback) => {
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            [DEVAPP_GATEWAY_TOKEN_HEADER]: gatewayToken,
          },
        })
      },
    )
    this.registeredSessionProtocols.add(targetSession)
  }
}
