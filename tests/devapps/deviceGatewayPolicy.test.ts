import { afterEach, describe, expect, it } from "vitest"

import { getTrustedDeviceGatewayBaseUrl } from "../../apps/desktop/electron/services/DeviceGatewayPolicy"

const originalAuth = process.env.VITE_AUTH_SERVER_URL
const originalCollab = process.env.VITE_COLLAB_BASE_URL

afterEach(() => {
  if (originalAuth === undefined) delete process.env.VITE_AUTH_SERVER_URL
  else process.env.VITE_AUTH_SERVER_URL = originalAuth
  if (originalCollab === undefined) delete process.env.VITE_COLLAB_BASE_URL
  else process.env.VITE_COLLAB_BASE_URL = originalCollab
})

describe("device gateway policy", () => {
  it("normalizes the build-owned gateway to an origin", () => {
    process.env.VITE_AUTH_SERVER_URL = "https://gateway.example/internal/path"
    expect(getTrustedDeviceGatewayBaseUrl()).toBe("https://gateway.example")
  })

  it("rejects an insecure non-loopback gateway", () => {
    process.env.VITE_AUTH_SERVER_URL = "http://gateway.example"
    expect(() => getTrustedDeviceGatewayBaseUrl()).toThrow("not configured securely")
  })
})
