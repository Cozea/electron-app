import type { Id } from '../../convex/_generated/dataModel'
import { invalidatePreviewImageCache } from './previewImageCache'

/**
 * Capture a screenshot of the given URL and upload it as the project preview.
 * Used when exiting the Pages view or exiting the project so the dashboard shows the latest state.
 *
 * @param projectId - Convex project ID
 * @param port - Dev server port (e.g. 3000)
 * @param path - Path to capture (e.g. "/" for home, or "/about"). Use "/" if no home page.
 * @param generatePreviewUploadUrl - Convex mutation to get upload URL
 * @param updatePreviewImage - Convex mutation to save storage ID on project
 */
export async function captureAndUploadProjectPreview(
  projectId: Id<'projects'>,
  port: number,
  path: string,
  generatePreviewUploadUrl: (args: { projectId: Id<'projects'> }) => Promise<string>,
  updatePreviewImage: (args: {
    projectId: Id<'projects'>
    storageId: Id<'_storage'>
  }) => Promise<unknown>
): Promise<void> {
  const pathNormalized = path.startsWith('/') ? path : `/${path}`
  const url = `http://localhost:${port}${pathNormalized}`
  try {
    const result = await window.electronAPI.preview.captureScreenshot({
      url,
      width: 1280,
      height: 800,
    })
    if (!result.success || !result.base64) return
    // Debug: screenshot taken
    alert(`[Debug] Screenshot taken: ${url}`)
    const byteString = atob(result.base64)
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i)
    const blob = new Blob([ab], { type: 'image/png' })
    const uploadUrl = await generatePreviewUploadUrl({ projectId })
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    })
    if (!uploadResponse.ok) return
    const data = await uploadResponse.json()
    const storageId = data?.storageId ?? data
    if (!storageId) return
    await updatePreviewImage({ projectId, storageId: storageId as Id<'_storage'> })
    invalidatePreviewImageCache(projectId)
    // Debug: preview updated
    alert(`[Debug] Project preview updated (projectId: ${projectId})`)
  } catch {
    // Silent: preview capture is best-effort for dashboard
  }
}

/**
 * Resolve the main page path for a project: home ("/") if present, otherwise first route.
 */
export function getMainPagePath(routes: { path: string }[]): string {
  const home = routes.find((r) => r.path === '/' || r.path === '')
  return home?.path ?? routes[0]?.path ?? '/'
}
