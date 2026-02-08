import type { SyncPlan, SyncProgress } from "./types"
import type { Id } from "../../../convex/_generated/dataModel"

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "pdf",
  "zip",
  "gz",
  "tar",
  "rar",
  "7z",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "avi",
  "webm",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "wasm",
])

function isBinaryPath(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? filePath
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : ""
  return !!ext && BINARY_EXTENSIONS.has(ext)
}

// MIME type mapping for common file extensions
const MIME_TYPES: Record<string, string> = {
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "application/javascript",
  jsx: "application/javascript",
  json: "application/json",
  css: "text/css",
  scss: "text/scss",
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  yaml: "text/yaml",
  yml: "text/yaml",
  xml: "text/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  webm: "video/webm",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  eot: "application/vnd.ms-fontobject",
  wasm: "application/wasm",
}

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  if (MIME_TYPES[ext]) return MIME_TYPES[ext]
  return isBinaryPath(filePath) ? "application/octet-stream" : "text/plain"
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ""

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const DEFAULT_CONCURRENCY = (() => {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.min(8, Math.max(2, navigator.hardwareConcurrency))
  }
  return 4
})()

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  if (tasks.length === 0) return []

  const results = new Array<T>(tasks.length)
  let index = 0

  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (true) {
      const current = index++
      if (current >= tasks.length) break
      results[current] = await tasks[current]()
    }
  })

  await Promise.all(workers)
  return results
}

export interface SyncExecutorOptions {
  projectId: Id<"projects">
  userId: Id<"users">
  projectPath: string
  onProgress: (progress: SyncProgress) => void
  // Convex mutation functions
  generateUploadUrl: () => Promise<string>
  saveFiles: (args: {
    projectId: Id<"projects">
    userId: Id<"users">
    files: Array<{
      storageId: Id<"_storage">
      fileName: string
      filePath: string
      fileType: string
      sizeBytes: number
      checksum: string
    }>
  }) => Promise<{ savedCount: number }>
  markFilesDeleted: (args: {
    projectId: Id<"projects">
    filePaths: string[]
  }) => Promise<{ deletedCount: number }>
  // Convex storage URL getter
  getStorageUrl: (storageId: Id<"_storage">) => Promise<string | null>
}

export interface SyncExecutorResult {
  success: boolean
  error?: string
  downloadedCount: number
  uploadedCount: number
  deletedCount: number
  mergedCount: number
}

/**
 * Execute a sync plan - perform all downloads, uploads, and deletes.
 */
export async function executeSyncPlan(
  plan: SyncPlan,
  options: SyncExecutorOptions
): Promise<SyncExecutorResult> {
  const {
    projectPath,
    onProgress,
    projectId,
    userId,
    generateUploadUrl,
    saveFiles,
    markFilesDeleted,
    getStorageUrl,
  } = options

  const logs: string[] = []
  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString()
    logs.push(`[${timestamp}] ${msg}`)
  }

  const autoMergedCount = plan.autoMerged?.length ?? 0
  const totalOps =
    plan.downloads.length +
    plan.uploads.length +
    plan.localDeletes.length +
    plan.cloudDeletes.length +
    autoMergedCount

  let completed = 0
  let downloadedCount = 0
  let uploadedCount = 0
  let deletedCount = 0
  let mergedCount = 0
  let writeFailureCount = 0

  const updateProgress = (message: string) => {
    onProgress({
      status: "syncing",
      message,
      current: completed,
      total: totalOps,
      logs: [...logs],
    })
  }

  try {
    // 1. Downloads (Cloud → Local)
    if (plan.downloads.length > 0) {
      addLog(`Downloading ${plan.downloads.length} files from cloud...`)
      updateProgress("Downloading files...")

      const filesToWrite: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }> = []

      const downloadTasks = plan.downloads.map((op) => async () => {
        if (!op.cloudEntry) return

        try {
          const url = await getStorageUrl(op.cloudEntry.storageId)
          if (!url) {
            addLog(`⚠ Could not get URL for: ${op.path}`)
            return
          }

          const response = await fetch(url)
          if (!response.ok) {
            addLog(`⚠ Failed to download: ${op.path}`)
            return
          }

          if (isBinaryPath(op.path)) {
            const buffer = await response.arrayBuffer()
            filesToWrite.push({
              path: op.path,
              content: arrayBufferToBase64(buffer),
              encoding: "base64",
            })
            addLog(`↓ Downloaded (binary): ${op.path}`)
          } else {
            const content = await response.text()
            filesToWrite.push({ path: op.path, content, encoding: "utf8" })
            addLog(`↓ Downloaded: ${op.path}`)
          }
          downloadedCount++
          completed++
          updateProgress(`Downloading: ${op.path}`)
        } catch (err) {
          addLog(`⚠ Error downloading ${op.path}: ${err instanceof Error ? err.message : "Unknown"}`)
        }
      })

      await runWithConcurrency(downloadTasks, DEFAULT_CONCURRENCY)

      // Write all downloaded files to local
      if (filesToWrite.length > 0) {
        const result = await window.electronAPI.sync.writeFiles({
          projectPath,
          files: filesToWrite,
        })
        if (result.successCount < filesToWrite.length) {
          const failed = filesToWrite.length - result.successCount
          writeFailureCount += failed
          addLog(`⚠ ${failed} downloaded file(s) failed to write locally`)
        }
      }
    }

    // 2. Auto-merged files (write merged content to local + upload to cloud)
    if (autoMergedCount > 0) {
      addLog(`Auto-merging ${autoMergedCount} files...`)
      updateProgress("Applying auto-merges...")

      const mergedFilesToWrite: Array<{ path: string; content: string; encoding: "utf8" }> = []
      const mergedFilesToUpload: Array<{
        storageId: Id<"_storage">
        fileName: string
        filePath: string
        fileType: string
        sizeBytes: number
        checksum: string
      }> = []

      const mergeTasks = (plan.autoMerged ?? []).map((op) => async () => {
        if (!op.mergeDetails) return

        try {
          const mimeType = getMimeType(op.path)
          const mergedContent = op.mergeDetails.mergedContent

          // Queue for local write
          mergedFilesToWrite.push({
            path: op.path,
            content: mergedContent,
            encoding: "utf8",
          })

          // Upload merged content to cloud
          const uploadUrl = await generateUploadUrl()
          const blob = new Blob([mergedContent], { type: mimeType })

          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: blob,
          })

          if (response.ok) {
            const { storageId } = await response.json()

            // Compute hash for merged content
            const encoder = new TextEncoder()
            const data = encoder.encode(mergedContent)
            const hashBuffer = await crypto.subtle.digest("SHA-256", data)
            const hashArray = Array.from(new Uint8Array(hashBuffer))
            const checksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

            mergedFilesToUpload.push({
              storageId,
              fileName: op.path.split("/").pop() || op.path,
              filePath: op.path,
              fileType: mimeType,
              sizeBytes: blob.size,
              checksum,
            })
          }

          addLog(
            `⊕ Auto-merged: ${op.path} (${op.mergeDetails.localChanges}L + ${op.mergeDetails.cloudChanges}C)`
          )
          mergedCount++
          completed++
          updateProgress(`Merged: ${op.path}`)
        } catch (err) {
          addLog(`⚠ Failed to merge ${op.path}: ${err instanceof Error ? err.message : "Unknown"}`)
        }
      })

      await runWithConcurrency(mergeTasks, DEFAULT_CONCURRENCY)

      // Write merged files locally
      if (mergedFilesToWrite.length > 0) {
        const result = await window.electronAPI.sync.writeFiles({
          projectPath,
          files: mergedFilesToWrite,
        })
        if (result.successCount < mergedFilesToWrite.length) {
          const failed = mergedFilesToWrite.length - result.successCount
          writeFailureCount += failed
          addLog(`⚠ ${failed} merged file(s) failed to write locally`)
        }
      }

      // Save merged files to cloud
      if (mergedFilesToUpload.length > 0) {
        await saveFiles({ projectId, userId, files: mergedFilesToUpload })
      }
    }

    // 3. Uploads (Local → Cloud)
    if (plan.uploads.length > 0) {
      addLog(`Uploading ${plan.uploads.length} files to cloud...`)
      updateProgress("Uploading files...")

      const uploadedFiles: Array<{
        storageId: Id<"_storage">
        fileName: string
        filePath: string
        fileType: string
        sizeBytes: number
        checksum: string
      }> = []

      for (const op of plan.uploads) {
        if (!op.localEntry) continue

        try {
          const isBinary = isBinaryPath(op.path)

          // Get upload URL from Convex
          const uploadUrl = await generateUploadUrl()

          // Determine MIME type
          const mimeType = getMimeType(op.path)

          // Read local file
          let blob: Blob
          if (isBinary) {
            const readResult = await window.electronAPI.project.readFileBase64({
              projectPath,
              filePath: op.path,
            })

            if (!readResult.success || !readResult.base64) {
              addLog(`⚠ Could not read: ${op.path}`)
              continue
            }

            const bytes = base64ToUint8Array(readResult.base64)
            blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
          } else {
            const readResult = await window.electronAPI.project.readFile({
              projectPath,
              filePath: op.path,
            })

            if (!readResult.success || readResult.content === undefined) {
              addLog(`⚠ Could not read: ${op.path}`)
              continue
            }

            blob = new Blob([readResult.content], { type: mimeType })
          }

          // Upload to Convex storage
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: blob,
          })

          if (!response.ok) {
            addLog(`⚠ Failed to upload: ${op.path}`)
            continue
          }

          const { storageId } = await response.json()

          uploadedFiles.push({
            storageId,
            fileName: op.path.split("/").pop() || op.path,
            filePath: op.path,
            fileType: mimeType,
            sizeBytes: op.localEntry.size,
            checksum: op.localEntry.hash,
          })

          addLog(`↑ Uploaded: ${op.path}`)
          uploadedCount++
          completed++
          updateProgress(`Uploading: ${op.path}`)
        } catch (err) {
          addLog(`⚠ Error uploading ${op.path}: ${err instanceof Error ? err.message : "Unknown"}`)
        }
      }

      // Save all uploaded files to Convex database
      if (uploadedFiles.length > 0) {
        await saveFiles({ projectId, userId, files: uploadedFiles })
      }
    }

    // 4. Local Deletes
    if (plan.localDeletes.length > 0) {
      addLog(`Deleting ${plan.localDeletes.length} local files...`)
      updateProgress("Cleaning up local files...")

      const pathsToDelete = plan.localDeletes.map((op) => op.path)
      const result = await window.electronAPI.sync.deleteFiles({
        projectPath,
        paths: pathsToDelete,
      })

      for (const op of plan.localDeletes) {
        addLog(`✕ Deleted locally: ${op.path}`)
        completed++
        deletedCount++
      }

      if (result.results.some((r) => !r.success)) {
        const failed = result.results.filter((r) => !r.success).length
        writeFailureCount += failed
        addLog(`⚠ ${failed} local file(s) could not be deleted`)
      }
    }

    // 5. Cloud Deletes
    if (plan.cloudDeletes.length > 0) {
      addLog(`Marking ${plan.cloudDeletes.length} cloud files as deleted...`)
      updateProgress("Cleaning up cloud files...")

      const pathsToDelete = plan.cloudDeletes.map((op) => op.cloudEntry?.path || op.path)
      await markFilesDeleted({ projectId, filePaths: pathsToDelete })

      for (const op of plan.cloudDeletes) {
        addLog(`✕ Deleted from cloud: ${op.path}`)
        completed++
        deletedCount++
      }
    }

    if (writeFailureCount > 0) {
      const error = `Sync completed with ${writeFailureCount} local filesystem failure(s)`
      addLog(`⚠ ${error}`)
      onProgress({
        status: "error",
        message: error,
        current: completed,
        total: totalOps,
        logs: [...logs],
      })
      return {
        success: false,
        error,
        downloadedCount,
        uploadedCount,
        deletedCount,
        mergedCount,
      }
    }

    // Success!
    addLog(`✓ Sync complete! ${plan.noChange} files unchanged.`)

    onProgress({
      status: "complete",
      message: "Sync complete",
      current: totalOps,
      total: totalOps,
      logs: [...logs],
    })

    return {
      success: true,
      downloadedCount,
      uploadedCount,
      deletedCount,
      mergedCount,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error"
    addLog(`✕ Sync failed: ${errorMsg}`)

    onProgress({
      status: "error",
      message: errorMsg,
      current: completed,
      total: totalOps,
      logs: [...logs],
    })

    return {
      success: false,
      error: errorMsg,
      downloadedCount,
      uploadedCount,
      deletedCount,
      mergedCount,
    }
  }
}
