import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const principalsSource = readFileSync(join(process.cwd(), "convex/devicePrincipals.ts"), "utf8")

function exportedSection(name: string, nextName: string): string {
  const start = principalsSource.indexOf(`export const ${name}`)
  const end = principalsSource.indexOf(`export const ${nextName}`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return principalsSource.slice(start, end)
}

describe("device presentation authority boundary", () => {
  it("does not overwrite custom presentation during device authentication", () => {
    const section = exportedSection(
      "ensureDevicePrincipalFromServer",
      "getDevicePrincipalForServer",
    )

    const existingPrincipalBranch = section.slice(
      section.indexOf("if (principal)"),
      section.indexOf("} else {", section.indexOf("if (principal)")),
    )

    expect(existingPrincipalBranch).not.toContain("displayName:")
    expect(existingPrincipalBranch).not.toContain("avatarStorageId:")
    expect(existingPrincipalBranch).toContain("encryptionPublicKeyJwk")
    expect(existingPrincipalBranch).toContain("lastAuthenticatedAt")
  })

  it("keeps display-name changes isolated from security state", () => {
    const section = exportedSection("updateDevicePresentation", "generateAvatarUploadUrl")

    expect(section).toContain("displayName")
    expect(section).not.toContain("signingPublicKey")
    expect(section).not.toContain("encryptionPublicKey")
    expect(section).not.toContain("signingKeyVersion")
    expect(section).not.toContain("tokenValidAfter")
    expect(section).not.toContain('status: "revoked"')
  })

  it("keeps avatar changes isolated from security state", () => {
    const section = exportedSection("setAvatar", "revokeCurrentDevice")

    expect(section).toContain("avatarStorageId")
    expect(section).toContain("ctx.storage")
    expect(section).not.toContain("signingPublicKey")
    expect(section).not.toContain("encryptionPublicKey")
    expect(section).not.toContain("signingKeyVersion")
    expect(section).not.toContain("tokenValidAfter")
  })
})
