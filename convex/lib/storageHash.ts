const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/

/**
 * Convex documents storage SHA-256 metadata as base16, but some hosted
 * deployments currently return the 32 digest bytes as padded base64. Normalize
 * both representations before comparing them with Cozea's canonical hex hash.
 */
export function normalizeStorageSha256(value: string): string | null {
  const normalized = value.trim()
  if (SHA256_HEX_PATTERN.test(normalized)) {
    return normalized.toLowerCase()
  }
  if (!SHA256_BASE64_PATTERN.test(normalized)) return null

  try {
    const binary = atob(normalized)
    if (binary.length !== 32) return null
    return Array.from(binary, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("")
  } catch {
    return null
  }
}
