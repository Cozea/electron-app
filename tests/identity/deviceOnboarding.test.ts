import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const users = readFileSync(join(process.cwd(), "convex/users.ts"), "utf8")
const authContext = readFileSync(
  join(process.cwd(), "apps/desktop/src/contexts/AuthContext.tsx"),
  "utf8",
)
const onboarding = readFileSync(
  join(process.cwd(), "apps/desktop/src/components/Onboarding.tsx"),
  "utf8",
)

describe("device principal onboarding", () => {
  it("does not promote the OS/device-auth label to a fresh principal display name", () => {
    const start = users.indexOf("export const ensureDevicePrincipalFromServer")
    const end = users.indexOf("export const getDevicePrincipalForServer", start)
    const section = users.slice(start, end)

    expect(section).toContain('const suggestedLabel = "This Device"')
    expect(section).not.toContain("const suggestedLabel = args.deviceLabel")
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
