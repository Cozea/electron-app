import { describe, expect, it } from "vitest"

import {
  createDeviceIdentityKey,
  createGroupIdentityKey,
  isDeviceIdentityKey,
  isGroupIdentityKey,
  normalizeDeviceIdentityKey,
  isTokenIssuedAfterRevocationBoundary,
} from "../../shared/deviceIdentity"

describe("device identity IDs", () => {
  it("creates a 128-bit copy-safe device ID", () => {
    const identityKey = createDeviceIdentityKey(new Uint8Array(16))

    expect(identityKey).toBe("czd_00000000000000000000000000")
    expect(isDeviceIdentityKey(identityKey)).toBe(true)
    expect(normalizeDeviceIdentityKey(`  ${identityKey.toUpperCase()}  `)).toBe(identityKey)
  })

  it("does not accept pre-cutover UUID identities", () => {
    expect(isDeviceIdentityKey("06483e76-86e5-42a7-af8a-d633f9679a17")).toBe(false)
    expect(() => createDeviceIdentityKey(new Uint8Array(15))).toThrow(/16 random bytes/)
  })

  it("creates a stable public group ID", () => {
    const groupId = createGroupIdentityKey("m1234567890abcdef")
    expect(groupId).toBe("czg_m1234567890abcdef")
    expect(isGroupIdentityKey(groupId)).toBe(true)
  })

  it("compares second-resolution JWT issue times to millisecond revocation boundaries", () => {
    expect(isTokenIssuedAfterRevocationBoundary(1_000, 1_000_999)).toBe(true)
    expect(isTokenIssuedAfterRevocationBoundary(999, 1_000_001)).toBe(false)
  })
})
