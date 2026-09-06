import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const principals = readFileSync(join(process.cwd(), "convex/devicePrincipals.ts"), "utf8")
const authContext = readFileSync(
  join(process.cwd(), "apps/desktop/src/contexts/AuthContext.tsx"),
  "utf8",
)
const onboarding = readFileSync(
  join(process.cwd(), "apps/desktop/src/components/Onboarding.tsx"),
  "utf8",
)

describe("device principal onboarding", () => {
  it("creates a fresh principal with an explicit unconfigured display name", () => {
    const start = principals.indexOf("export const ensureDevicePrincipalFromServer")
    const end = principals.indexOf("export const getDevicePrincipalForServer", start)
    const section = principals.slice(start, end)

    expect(section).toContain('displayName: "This Device"')
    expect(section).not.toContain("deviceLabel")
    expect(section).not.toContain("email")
    expect(section).not.toContain("firstName")
    expect(section).not.toContain("lastName")
  })

  it("treats an unconfigured device as onboarding-required", () => {
    expect(authContext).toContain("UNCONFIGURED_DEVICE_NAME = 'This Device'")
    expect(authContext).toContain("needsOnboarding")
    expect(authContext).not.toContain("needsOnboarding: false")
  })

  it("requires a user-selected device name and updates presentation only", () => {
    expect(onboarding).toContain("Name this device")
    expect(onboarding).toContain("updateDevicePresentation")
    expect(onboarding).toContain("displayName: normalizedDeviceName")
    expect(onboarding).toContain("refreshToken()")
    expect(onboarding).not.toContain("useProjectCreationMenu")
    expect(onboarding).not.toContain("email")
    expect(onboarding).not.toContain("password")
  })
})
