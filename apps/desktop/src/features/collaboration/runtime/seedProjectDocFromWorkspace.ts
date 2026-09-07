import * as Y from "yjs"

import { isBinaryFile } from "@/lib/sync/BinaryFileSync"
import type { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"

export interface CollaborationSeedFile {
  path: string
  sizeBytes: number
}

export interface CollaborationSeedResult {
  seededFiles: number
  skippedFiles: number
  failedFiles: number
}

const MAX_INITIAL_TEXT_FILE_BYTES = 2 * 1024 * 1024
const INITIAL_READ_CONCURRENCY = 8

function normalizeSeedPath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").trim()
  if (!normalized) return null
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null
  }
  return normalized
}

export function selectCollaborationSeedFiles(
  files: CollaborationSeedFile[],
): CollaborationSeedFile[] {
  const selected: CollaborationSeedFile[] = []
  const seen = new Set<string>()

  for (const file of files) {
    const path = normalizeSeedPath(file.path)
    if (!path || seen.has(path)) continue
    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes < 0) continue
    if (file.sizeBytes > MAX_INITIAL_TEXT_FILE_BYTES || isBinaryFile(path)) continue
    seen.add(path)
    selected.push({ path, sizeBytes: Math.floor(file.sizeBytes) })
  }

  return selected.sort((left, right) => left.path.localeCompare(right.path))
}

async function readSeedBatch(
  workspaceId: string,
  files: CollaborationSeedFile[],
): Promise<Array<{ path: string; content: string } | null>> {
  return await Promise.all(
    files.map(async (file) => {
      try {
        const result = await window.electronAPI.project.readFile({
          workspaceId,
          filePath: file.path,
        })
        if (!result.success || typeof result.content !== "string") return null
        return { path: file.path, content: result.content }
      } catch {
        return null
      }
    }),
  )
}

/**
 * Populate a brand-new collaboration document from the local Git checkout.
 *
 * This runs only when neither encrypted local state nor server state contains a
 * project tree. It is completed before the websocket provider starts, and uses
 * the `init` origin so activity logging and outbound collaboration transport do
 * not treat the base tree as user edits.
 */
export async function seedProjectDocFromWorkspace(args: {
  doc: YjsProjectDoc
  workspaceId: string | null
}): Promise<CollaborationSeedResult> {
  if (!args.workspaceId || args.doc.files.size > 0) {
    return { seededFiles: 0, skippedFiles: 0, failedFiles: 0 }
  }

  const listed = await window.electronAPI.project.listFiles({
    workspaceId: args.workspaceId,
  })
  if (!listed.success || !listed.files) {
    throw new Error(listed.error || "Failed to list files for collaboration seeding")
  }

  const selected = selectCollaborationSeedFiles(listed.files)
  const skippedFiles = Math.max(0, listed.files.length - selected.length)
  const contents: Array<{ path: string; content: string }> = []
  let failedFiles = 0

  for (let index = 0; index < selected.length; index += INITIAL_READ_CONCURRENCY) {
    const batch = selected.slice(index, index + INITIAL_READ_CONCURRENCY)
    const results = await readSeedBatch(args.workspaceId, batch)
    for (const result of results) {
      if (result) contents.push(result)
      else failedFiles += 1
    }
  }

  args.doc.doc.transact(() => {
    for (const file of contents) {
      if (args.doc.files.has(file.path)) continue
      const text = new Y.Text()
      args.doc.files.set(file.path, text)
      if (file.content.length > 0) {
        text.insert(0, file.content)
      }
    }
  }, "init")

  return {
    seededFiles: contents.length,
    skippedFiles,
    failedFiles,
  }
}
