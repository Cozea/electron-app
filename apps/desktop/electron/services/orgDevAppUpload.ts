import { hashBuffer } from "./orgDevAppZip"

interface PackedDevAppUpload {
  zip: Uint8Array
  contentHash: string
}

interface UploadedStorageResponse {
  storageId?: unknown
}

export interface OrgDevAppUploadResult {
  storageId: string
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export function validateConvexUploadUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== "https:" ||
    !hostname.endsWith(".convex.cloud") ||
    !url.pathname.startsWith("/api/storage/upload")
  ) {
    throw new Error("The DevApp upload destination is not trusted.")
  }
  return url
}

export async function uploadPackedDevApp(
  uploadUrl: string,
  packed: PackedDevAppUpload,
  options: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<OrgDevAppUploadResult> {
  const destination = validateConvexUploadUrl(uploadUrl)
  const zip = Buffer.from(packed.zip)
  if (hashBuffer(zip) !== packed.contentHash.toLowerCase()) {
    throw new Error("The built DevApp artifact changed before upload.")
  }

  const uploadResponse = await (options.fetch ?? fetch)(destination, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip,
    signal: options.signal,
  })
  if (!uploadResponse.ok) {
    throw new Error("Cozea could not upload the built DevApp artifact.")
  }
  const uploaded = (await uploadResponse.json()) as UploadedStorageResponse
  if (typeof uploaded.storageId !== "string" || !uploaded.storageId) {
    throw new Error("Cozea did not receive a storage id for the DevApp artifact.")
  }
  return { storageId: uploaded.storageId }
}
