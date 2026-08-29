import { describe, expect, it } from "vitest"

import { normalizeStorageSha256 } from "../../convex/lib/storageHash"

describe("normalizeStorageSha256", () => {
  const hex = "a2f353ce6c9fe921c25ea2fbefbca949ab870ad08fd45fe55cda9bf37a71f8c8"

  it("normalizes documented base16 metadata", () => {
    expect(normalizeStorageSha256(hex.toUpperCase())).toBe(hex)
  })

  it("normalizes hosted Convex base64 metadata without changing its case", () => {
    expect(normalizeStorageSha256("ovNTzmyf6SHCXqL777ypSauHCtCP1F/lXNqb83px+Mg=")).toBe(hex)
  })

  it("rejects malformed or incorrectly sized digests", () => {
    expect(normalizeStorageSha256("not-a-hash")).toBeNull()
    expect(normalizeStorageSha256("YQ==")).toBeNull()
  })
})
