export const NATIVE_DEV_APP_MODULE_SCHEME = "cozea-native-devapp"
export const NATIVE_DEV_APP_MODULE_PROTOCOL_VERSION = 1 as const

const REGISTRATION_ID = /^[0-9a-f]{32}$/
const GENERATION_ID = /^[A-Za-z0-9._-]{1,128}$/

export interface NativeDevAppModuleAddress {
  registrationId: string
  generation: string
  assetPath: string
}

export function normalizeNativeDevAppAssetPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return null
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) return null
  const segments = value.split("/")
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || segment.length > 255,
    )
  ) {
    return null
  }
  return segments.join("/")
}

export function isNativeDevAppRegistrationId(value: unknown): value is string {
  return typeof value === "string" && REGISTRATION_ID.test(value)
}

export function isNativeDevAppGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION_ID.test(value)
}

export function buildNativeDevAppModuleUrl(address: NativeDevAppModuleAddress): string {
  if (!isNativeDevAppRegistrationId(address.registrationId)) {
    throw new Error("The native DevApp registration ID is invalid.")
  }
  if (!isNativeDevAppGeneration(address.generation)) {
    throw new Error("The native DevApp generation is invalid.")
  }
  const assetPath = normalizeNativeDevAppAssetPath(address.assetPath)
  if (!assetPath) throw new Error("The native DevApp asset path is invalid.")
  const encodedPath = assetPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${NATIVE_DEV_APP_MODULE_SCHEME}://${address.registrationId}/${encodedPath}?generation=${encodeURIComponent(address.generation)}`
}

export function parseNativeDevAppModuleUrl(value: string): NativeDevAppModuleAddress | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== `${NATIVE_DEV_APP_MODULE_SCHEME}:`) return null
  if (
    !isNativeDevAppRegistrationId(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null
  }
  if ([...url.searchParams.keys()].some((key) => key !== "generation")) return null
  const generation = url.searchParams.get("generation")
  if (!isNativeDevAppGeneration(generation)) return null

  const rawSegments = url.pathname.replace(/^\/+/, "").split("/")
  const decodedSegments: string[] = []
  try {
    for (const segment of rawSegments) {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes("/") || decoded.includes("\\")) return null
      decodedSegments.push(decoded)
    }
  } catch {
    return null
  }
  const assetPath = normalizeNativeDevAppAssetPath(decodedSegments.join("/"))
  return assetPath
    ? { registrationId: url.hostname, generation, assetPath }
    : null
}
