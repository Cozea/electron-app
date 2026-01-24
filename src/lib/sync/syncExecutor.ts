import type { SyncPlan, SyncProgress } from "./types"
import type { Id } from "../../../convex/_generated/dataModel"

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
}

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return MIME_TYPES[ext] || "text/plain"
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

  const totalOps =
    plan.downloads.length +
    plan.uploads.length +
    plan.localDeletes.length +
    plan.cloudDeletes.length

  let completed = 0
  let downloadedCount = 0
  let uploadedCount = 0
  let deletedCount = 0

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

      const filesToWrite: Array<{ path: string; content: string }> = []

      for (const op of plan.downloads) {
        if (!op.cloudEntry) continue

        try {
          const url = await getStorageUrl(op.cloudEntry.storageId)
          if (!url) {
            addLog(`⚠ Could not get URL for: ${op.path}`)
            continue
          }

          const response = await fetch(url)
          if (!response.ok) {
            addLog(`⚠ Failed to download: ${op.path}`)
            continue
          }

          const content = await response.text()
          filesToWrite.push({ path: op.path, content })
          addLog(`↓ Downloaded: ${op.path}`)
          downloadedCount++
          completed++
          updateProgress(`Downloading: ${op.path}`)
        } catch (err) {
          addLog(`⚠ Error downloading ${op.path}: ${err instanceof Error ? err.message : "Unknown"}`)
        }
      }

      // Write all downloaded files to local
      if (filesToWrite.length > 0) {
        const result = await window.electronAPI.sync.writeFiles({
          projectPath,
          files: filesToWrite,
        })
        if (result.successCount < filesToWrite.length) {
          addLog(`⚠ Some files failed to write locally`)
        }
      }
    }

    // 2. Uploads (Local → Cloud)
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
          // Read local file
          const readResult = await window.electronAPI.project.readFile({
            projectPath,
            filePath: op.path,
          })

          if (!readResult.success || !readResult.content) {
            addLog(`⚠ Could not read: ${op.path}`)
            continue
          }

          // Get upload URL from Convex
          const uploadUrl = await generateUploadUrl()

          // Determine MIME type
          const mimeType = getMimeType(op.path)

          // Upload to Convex storage
          const blob = new Blob([readResult.content], { type: mimeType })
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

    // 3. Local Deletes
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
        addLog(`⚠ Some local files could not be deleted`)
      }
    }

    // 4. Cloud Deletes
    if (plan.cloudDeletes.length > 0) {
      addLog(`Marking ${plan.cloudDeletes.length} cloud files as deleted...`)
      updateProgress("Cleaning up cloud files...")

      const pathsToDelete = plan.cloudDeletes.map((op) => op.path)
      await markFilesDeleted({ projectId, filePaths: pathsToDelete })

      for (const op of plan.cloudDeletes) {
        addLog(`✕ Deleted from cloud: ${op.path}`)
        completed++
        deletedCount++
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
    }
  }
}
