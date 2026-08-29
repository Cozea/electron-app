const CROCKFORD_BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

export const DEVICE_IDENTITY_PREFIX = "czd_"
export const GROUP_IDENTITY_PREFIX = "czg_"

const DEVICE_IDENTITY_PATTERN = /^czd_[0-9a-hjkmnp-tv-z]{26}$/
const GROUP_IDENTITY_PATTERN = /^czg_[a-z0-9_-]{8,80}$/

function encodeCrockfordBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let encoded = ""

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      encoded += CROCKFORD_BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    encoded += CROCKFORD_BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return encoded
}

export function createDeviceIdentityKey(randomBytes: Uint8Array): string {
  if (randomBytes.byteLength !== 16) {
    throw new Error("Device identity keys require exactly 16 random bytes.")
  }
  return `${DEVICE_IDENTITY_PREFIX}${encodeCrockfordBase32(randomBytes)}`
}

export function normalizeDeviceIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

export function isTokenIssuedAfterRevocationBoundary(
  issuedAtSeconds: number,
  tokenValidAfterMs: number,
): boolean {
  return Number.isFinite(issuedAtSeconds) && Number.isFinite(tokenValidAfterMs) &&
    issuedAtSeconds >= Math.floor(tokenValidAfterMs / 1_000)
}

export function isDeviceIdentityKey(value: string): boolean {
  return DEVICE_IDENTITY_PATTERN.test(normalizeDeviceIdentityKey(value))
}

export function createGroupIdentityKey(organizationId: string): string {
  const normalized = organizationId.trim().toLowerCase()
  if (!/^[a-z0-9_-]{8,80}$/.test(normalized)) {
    throw new Error("Organization ID cannot be converted into a group identity key.")
  }
  return `${GROUP_IDENTITY_PREFIX}${normalized}`
}

export function normalizeGroupIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

export function isGroupIdentityKey(value: string): boolean {
  return GROUP_IDENTITY_PATTERN.test(normalizeGroupIdentityKey(value))
}
