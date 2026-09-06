import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const usersSource = readFileSync(join(process.cwd(), "convex/users.ts"), "utf8")

function exportedSection(name: string, nextName: string): string {
  const start = usersSource.indexOf(`export const ${name}`)
  const end = usersSource.indexOf(`export const ${nextName}`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return usersSource.slice(start, end)
}

describe("device presentation authority boundary", () => {
  it("does not overwrite custom presentation during device authentication", () => {
    const section = exportedSection(
      "ensureDevicePrincipalFromServer",
      "getDevicePrincipalForServer",
    )

    const existingPrincipalBranch = section.slice(
      section.indexOf("if (canonicalUser)"),
      section.indexOf("} else {", section.indexOf("if (canonicalUser)")),
    )

    expect(existingPrincipalBranch).not.toContain("deviceLabel: suggestedLabel")
    expect(existingPrincipalBranch).not.toContain("firstName: suggestedLabel")
    expect(existingPrincipalBranch).not.toContain("profileImageUrl: undefined")
    expect(existingPrincipalBranch).toContain("encryptionPublicKeyJwk")
    expect(existingPrincipalBranch).toContain("lastAuthenticatedAt")
  })

  it("keeps presentation changes isolated from security state", () => {
    const section = exportedSection("updateDevicePresentation", "updateProfile")

    expect(section).toContain("deviceLabel")
    expect(section).toContain("profileImageUrl")
    expect(section).not.toContain("signingPublicKey")
    expect(section).not.toContain("encryptionPublicKey")
    expect(section).not.toContain("signingKeyVersion")
    expect(section).not.toContain("tokenValidAfter")
    expect(section).not.toContain("status: \"revoked\"")
  })
})
