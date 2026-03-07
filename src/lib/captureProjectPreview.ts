import type { Id } from '../../convex/_generated/dataModel'
import { invalidatePreviewImageCache } from './previewImageCache'

const DEFAULT_CAPTURE_WIDTH = 1280
const DEFAULT_CAPTURE_HEIGHT = 800
const DEFAULT_CAPTURE_ATTEMPTS = 4
const RETRY_DELAYS_MS = [900, 1600, 2400]

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function pngBase64ToBlob(base64: string): Blob {
  const byteString = atob(base64)
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i += 1) {
    bytes[i] = byteString.charCodeAt(i)
  }
  return new Blob([bytes], { type: 'image/png' })
}

export function isLikelyBlankPreviewImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return false
  }

  const sampleColumns = Math.min(48, width)
  const sampleRows = Math.min(32, height)
  const stepX = Math.max(1, Math.floor(width / sampleColumns))
  const stepY = Math.max(1, Math.floor(height / sampleRows))
  const centerMinX = Math.floor(width * 0.2)
  const centerMaxX = Math.ceil(width * 0.8)
  const centerMinY = Math.floor(height * 0.2)
  const centerMaxY = Math.ceil(height * 0.8)

  let opaqueSamples = 0
  let nearWhiteSamples = 0
  let interestingSamples = 0
  let centerInterestingSamples = 0

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const index = (y * width + x) * 4
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const a = pixels[index + 3]

      if (a < 16) continue

      opaqueSamples += 1

      const brightness = (r + g + b) / 3
      const channelSpread = Math.max(r, g, b) - Math.min(r, g, b)
      const isNearWhite = r >= 246 && g >= 246 && b >= 246
      const isInteresting = brightness < 238 || channelSpread > 14 || a < 245

      if (isNearWhite) {
        nearWhiteSamples += 1
      }

      if (isInteresting) {
        interestingSamples += 1
        if (x >= centerMinX && x <= centerMaxX && y >= centerMinY && y <= centerMaxY) {
          centerInterestingSamples += 1
        }
      }
    }
  }

  if (opaqueSamples === 0) return false

  const nearWhiteRatio = nearWhiteSamples / opaqueSamples
  const interestingRatio = interestingSamples / opaqueSamples

  return nearWhiteRatio >= 0.995 && interestingRatio <= 0.006 && centerInterestingSamples === 0
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('Failed to create preview analysis canvas')
      }
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error('Failed to decode preview image'))
      nextImage.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Failed to create preview analysis canvas')
    }

    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function isLikelyBlankPreviewBlob(blob: Blob): Promise<boolean> {
  const imageData = await blobToImageData(blob)
  return isLikelyBlankPreviewImageData(imageData.data, imageData.width, imageData.height)
}

export async function captureProjectPreviewBlob(
  url: string,
  options?: {
    width?: number
    height?: number
    attempts?: number
  }
): Promise<Blob> {
  const width = options?.width ?? DEFAULT_CAPTURE_WIDTH
  const height = options?.height ?? DEFAULT_CAPTURE_HEIGHT
  const attempts = Math.max(1, options?.attempts ?? DEFAULT_CAPTURE_ATTEMPTS)
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await window.electronAPI.preview.captureScreenshot({
      url,
      width,
      height,
    })

    if (!result.success || !result.base64) {
      lastError = new Error(result.error || 'Screenshot capture failed')
    } else {
      const blob = pngBase64ToBlob(result.base64)
      if (!(await isLikelyBlankPreviewBlob(blob))) {
        return blob
      }
      lastError = new Error('Preview rendered blank')
    }

    if (attempt < attempts - 1) {
      const retryDelay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 1000
      await wait(retryDelay)
    }
  }

  throw lastError ?? new Error('Screenshot capture failed')
}

export async function uploadProjectPreviewBlob(
  projectId: Id<'projects'>,
  blob: Blob,
  generatePreviewUploadUrl: (args: { projectId: Id<'projects'> }) => Promise<string>,
  updatePreviewImage: (args: {
    projectId: Id<'projects'>
    storageId: Id<'_storage'>
  }) => Promise<unknown>
): Promise<void> {
  const uploadUrl = await generatePreviewUploadUrl({ projectId })
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  })

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload preview screenshot')
  }

  const data = await uploadResponse.json()
  const storageId = data?.storageId ?? data
  if (!storageId) {
    throw new Error('Preview upload did not return a storage ID')
  }

  await updatePreviewImage({ projectId, storageId: storageId as Id<'_storage'> })
  invalidatePreviewImageCache(projectId)
}

export async function captureAndUploadProjectPreviewFromUrl(
  projectId: Id<'projects'>,
  url: string,
  generatePreviewUploadUrl: (args: { projectId: Id<'projects'> }) => Promise<string>,
  updatePreviewImage: (args: {
    projectId: Id<'projects'>
    storageId: Id<'_storage'>
  }) => Promise<unknown>,
  options?: {
    width?: number
    height?: number
    attempts?: number
  }
): Promise<void> {
  const blob = await captureProjectPreviewBlob(url, options)
  await uploadProjectPreviewBlob(projectId, blob, generatePreviewUploadUrl, updatePreviewImage)
}

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
  await captureAndUploadProjectPreviewFromUrl(
    projectId,
    url,
    generatePreviewUploadUrl,
    updatePreviewImage
  )
}

/**
 * Resolve the main page path for a project: home ("/") if present, otherwise first route.
 */
export function getMainPagePath(routes: { path: string }[]): string {
  const home = routes.find((r) => r.path === '/' || r.path === '')
  return home?.path ?? routes[0]?.path ?? '/'
}
