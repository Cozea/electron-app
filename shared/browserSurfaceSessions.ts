import type { BrowserSurfaceDescriptor } from "./browserSurfaceTypes"

/**
 * Which Electron session a surface gets.
 *
 * This is a storage isolation boundary, not a naming convention: two surfaces sharing a
 * partition share cookies, localStorage, IndexedDB and service workers. Extracted from
 * `T3BrowserSurfaceService` so the boundary can be asserted directly rather than by
 * grepping the service's source for the right template literal.
 */

function normalizeSessionSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9_-]+/gi, "-")
  return normalized.length > 0 ? normalized.slice(0, 120) : "default"
}

export function partitionForDescriptor(descriptor: BrowserSurfaceDescriptor): string {
  if (descriptor.storageScope === "global") {
    return "persist:cozea-browser-global"
  }
  if (descriptor.storageScope === "orgDevApp" && descriptor.publicationId) {
    return `persist:cozea-devapp-${normalizeSessionSegment(descriptor.publicationId)}`
  }
  if (descriptor.storageScope === "devAppPreview" && descriptor.devSourceId) {
    // The dot cannot appear in the published branch above — normalizeSessionSegment
    // reduces a publication id to [A-Za-z0-9_-] — so an unpublished package can never be
    // handed the session of a published app, whatever a publication happens to be named.
    return `persist:cozea-devapp-preview.${normalizeSessionSegment(descriptor.devSourceId)}`
  }
  if (descriptor.storageScope === "workspace" && descriptor.workspaceId) {
    return `persist:cozea-browser-workspace-${normalizeSessionSegment(descriptor.workspaceId)}`
  }
  return `cozea-browser-ephemeral-${normalizeSessionSegment(descriptor.tileId)}`
}
