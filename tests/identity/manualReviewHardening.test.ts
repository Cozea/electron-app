import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

describe("manual identity review hardening", () => {
  it("uses explicit presentation lifecycle state instead of a display-name sentinel", () => {
    expect(read("convex/schema.ts")).toContain("presentationConfiguredAt")
    const auth = read("apps/desktop/src/contexts/AuthContext.tsx")
    expect(auth).toContain("!user.presentationConfigured")
    expect(auth).not.toContain("UNCONFIGURED_DEVICE_NAME")
  })

  it("does not allow authentication to rotate the registered ECDH identity", () => {
    const source = read("convex/devicePrincipals.ts")
    const existingStart = source.indexOf("if (principal) {")
    const existingEnd = source.indexOf("} else {", existingStart)
    const existingPrincipalAuth = source.slice(existingStart, existingEnd)
    expect(existingPrincipalAuth).toContain("already bound to another encryption key")
    expect(existingPrincipalAuth).not.toContain("encryptionPublicKeyJwk: args.encryptionPublicKeyJwk")
  })

  it("owns avatar storage inside an authenticated Convex action", () => {
    const source = read("convex/devicePrincipals.ts")
    expect(source).toContain("export const uploadAvatar = action")
    expect(source).toContain("ctx.storage.store")
    expect(source).toContain("ctx.runMutation(commitAvatarUploadRef")
    expect(source).not.toContain("generateAvatarUploadUrl")
    expect(source).not.toContain("export const setAvatar = mutation")
  })

  it("binds room-key requests to canonical principal encryption metadata", () => {
    const source = read("convex/yjs.ts")
    expect(source).toContain("export const createKeyRequest = baseMutation")
    expect(source).toContain("recipientPublicKeyJwk: principal.encryptionPublicKeyJwk")
    expect(source).toContain("recipientFingerprint: principal.encryptionFingerprint")
    expect(source).toContain("keyRequestId: v.id(\"projectCollabKeyRequests\")")
  })

  it("has no direct project member add bypass", () => {
    expect(read("convex/projectMembers.ts")).not.toContain("export const addMember")
  })
})
