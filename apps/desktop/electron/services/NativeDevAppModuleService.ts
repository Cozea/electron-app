import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { net, protocol } from "electron"

import {
  NATIVE_DEV_APP_MODULE_SCHEME,
  buildNativeDevAppModuleUrl,
  isNativeDevAppGeneration,
  isNativeDevAppRegistrationId,
  parseNativeDevAppModuleUrl,
} from "../../../../shared/nativeDevAppModuleProtocol"

interface RegisteredNativeDevAppBuild {
  root: string
  generation: string
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/**
 * Serves verified native DevApp build output to the main renderer.
 *
 * The renderer receives an opaque registration id and generation, never a filesystem
 * location. Every request is resolved through real paths and confined to the build root,
 * so source symlinks and encoded traversal cannot turn module loading into arbitrary file
 * access.
 */
export class NativeDevAppModuleService {
  private readonly registrations = new Map<string, RegisteredNativeDevAppBuild>()
  private protocolRegistered = false

  registerBuild(options: {
    registrationId: string
    generation: string
    root: string
  }): void {
    if (!isNativeDevAppRegistrationId(options.registrationId)) {
      throw new Error("The native DevApp registration ID is invalid.")
    }
    if (!isNativeDevAppGeneration(options.generation)) {
      throw new Error("The native DevApp generation is invalid.")
    }
    const root = fs.realpathSync.native(options.root)
    if (!fs.statSync(root).isDirectory()) {
      throw new Error("The native DevApp build root is not a directory.")
    }
    this.registrations.set(options.registrationId, {
      root,
      generation: options.generation,
    })
  }

  releaseBuild(registrationId: string, generation?: string): boolean {
    const current = this.registrations.get(registrationId)
    if (!current || (generation && current.generation !== generation)) return false
    return this.registrations.delete(registrationId)
  }

  buildAssetUrl(registrationId: string, generation: string, assetPath: string): string {
    const current = this.registrations.get(registrationId)
    if (!current || current.generation !== generation) {
      throw new Error("The native DevApp build is no longer registered.")
    }
    return buildNativeDevAppModuleUrl({ registrationId, generation, assetPath })
  }

  registerProtocol(): void {
    if (this.protocolRegistered) return
    protocol.handle(NATIVE_DEV_APP_MODULE_SCHEME, (request) => this.handleRequest(request))
    this.protocolRegistered = true
  }

  dispose(): void {
    this.registrations.clear()
    if (this.protocolRegistered) {
      try {
        protocol.unhandle(NATIVE_DEV_APP_MODULE_SCHEME)
      } catch {
        // Electron may already be tearing down the default session.
      }
      this.protocolRegistered = false
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed", 405, { allow: "GET, HEAD" })
    }

    const address = parseNativeDevAppModuleUrl(request.url)
    if (!address) return textResponse("Invalid native DevApp module URL", 400)

    const registration = this.registrations.get(address.registrationId)
    if (!registration || registration.generation !== address.generation) {
      return textResponse("Native DevApp build is no longer active", 410)
    }

    const filePath = resolveBuildAsset(registration.root, address.assetPath)
    if (!filePath) return textResponse("Native DevApp asset not found", 404)

    const source = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(source.headers)
    headers.set("content-type", mimeForPath(filePath))
    headers.set("cache-control", "no-store")
    headers.set("access-control-allow-origin", "*")
    headers.set("cross-origin-resource-policy", "cross-origin")
    headers.set("x-content-type-options", "nosniff")
    return new Response(request.method === "HEAD" ? null : source.body, {
      status: source.status,
      headers,
    })
  }
}

function resolveBuildAsset(root: string, assetPath: string): string | null {
  try {
    const candidate = path.resolve(root, assetPath)
    if (!isInside(root, candidate)) return null
    const real = fs.realpathSync.native(candidate)
    if (!isInside(root, real) || !fs.statSync(real).isFile()) return null
    return real
  } catch {
    return null
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function mimeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

function textResponse(
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  })
}
