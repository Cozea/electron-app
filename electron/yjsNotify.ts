import path from "node:path"

import { BrowserWindow, webContents } from "electron"

import { GitChangesBroadcaster } from "./services/GitChangesBroadcaster"
import { markProjectAnalysisStaleForFile } from "./services/ProjectAnalysisService"
import {
  applyProjectFileDeleteToIndex,
  applyProjectFileMetaChangeToIndex,
} from "./services/ProjectFileIndexService"

export interface ExternalFileChangePayload {
  filePath: string
  content: string
  origin?: string | import("../shared/electronApiTypes").FileChangeAttribution
}

export interface ExternalFileMetaChangePayload {
  filePath: string
  origin?: string | import("../shared/electronApiTypes").FileChangeAttribution
  isBinary: boolean
  isDirectory?: boolean
  sizeBytes: number
  content?: string
}

export interface ExternalFileDeletePayload {
  filePath: string
  origin?: string | import("../shared/electronApiTypes").FileChangeAttribution
}

/** Normalized absolute roots per renderer webContents id (set via yjs:setInterestRoots). */
const interestRootsByWebContentsId = new Map<number, string[]>()

export function setYjsInterestRootsFromRenderer(webContentsId: number, roots: string[]): void {
  const resolved = dedupeResolvedRoots(roots)
  if (resolved.length === 0) {
    interestRootsByWebContentsId.delete(webContentsId)
  } else {
    interestRootsByWebContentsId.set(webContentsId, resolved)
  }
}

function dedupeResolvedRoots(roots: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of roots) {
    if (!raw || typeof raw !== "string") continue
    try {
      const resolved = path.resolve(raw)
      const key = resolved.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(resolved)
    } catch {
      // ignore invalid paths from renderer
    }
  }
  return out
}

function isFileUnderRoot(filePath: string, root: string): boolean {
  try {
    const fileResolved = path.resolve(filePath)
    const rootResolved = path.resolve(root)
    if (fileResolved === rootResolved) return true
    const rel = path.relative(rootResolved, fileResolved)
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
  } catch {
    return false
  }
}

function fileMatchesAnyRoot(filePath: string, roots: string[]): boolean {
  for (const root of roots) {
    if (isFileUnderRoot(filePath, root)) return true
  }
  return false
}

function pruneStaleInterestEntry(webContentsId: number): void {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) {
    interestRootsByWebContentsId.delete(webContentsId)
  }
}

function forEachLiveWindow(fn: (window: BrowserWindow) => void): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    const { webContents } = window
    if (webContents.isDestroyed()) continue
    fn(window)
  }
}

function forEachInterestedWindowForPath(filePath: string, fn: (window: BrowserWindow) => void): void {
  if (interestRootsByWebContentsId.size === 0) {
    forEachLiveWindow(fn)
    return
  }

  const sentWindowIds = new Set<number>()

  for (const [wcId, roots] of [...interestRootsByWebContentsId.entries()]) {
    if (!fileMatchesAnyRoot(filePath, roots)) continue

    pruneStaleInterestEntry(wcId)
    if (!interestRootsByWebContentsId.has(wcId)) continue

    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      interestRootsByWebContentsId.delete(wcId)
      continue
    }

    const win = BrowserWindow.fromWebContents(wc)
    if (!win || win.isDestroyed()) continue
    if (sentWindowIds.has(win.id)) continue
    sentWindowIds.add(win.id)
    fn(win)
  }
}

export function notifyFileChanged(
  filePath: string,
  content: string,
  options?: { origin?: string | import("../shared/electronApiTypes").FileChangeAttribution },
): void {
  const payload: ExternalFileChangePayload = {
    filePath,
    content,
    origin: options?.origin,
  }
  forEachInterestedWindowForPath(filePath, (window) => {
    window.webContents.send("yjs:external-file-change", payload)
  })
  GitChangesBroadcaster.getInstance().invalidateFilePath(filePath)
}

export function notifyFileMetaChanged(payload: ExternalFileMetaChangePayload): void {
  applyProjectFileMetaChangeToIndex(payload)
  markProjectAnalysisStaleForFile(payload.filePath)
  forEachInterestedWindowForPath(payload.filePath, (window) => {
    window.webContents.send("yjs:external-file-meta-change", payload)
  })
  GitChangesBroadcaster.getInstance().invalidateFilePath(payload.filePath)
}

export function notifyFileDeleted(
  filePath: string,
  options?: { origin?: string | import("../shared/electronApiTypes").FileChangeAttribution },
): void {
  applyProjectFileDeleteToIndex(filePath)
  markProjectAnalysisStaleForFile(filePath)
  const payload: ExternalFileDeletePayload = {
    filePath,
    origin: options?.origin,
  }
  forEachInterestedWindowForPath(filePath, (window) => {
    window.webContents.send("yjs:external-file-delete", payload)
  })
  GitChangesBroadcaster.getInstance().invalidateFilePath(filePath)
}
