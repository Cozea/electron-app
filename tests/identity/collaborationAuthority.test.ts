import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()
const workerSession = fs.readFileSync(
  path.join(root, "cloudflare/worker/src/routes/sessionRoom.ts"),
  "utf8",
)
const workerConvex = fs.readFileSync(
  path.join(root, "cloudflare/worker/src/lib/convex.ts"),
  "utf8",
)
const schema = fs.readFileSync(path.join(root, "convex/schema.ts"), "utf8")

describe("collaboration authority boundary", () => {
  it("requires a device bearer and fails closed on session room access", () => {
    expect(workerSession).toContain("Device authentication is required")
    expect(workerSession).toContain("verifyDeviceAccessToken")
    expect(workerConvex).toContain("authorizeSessionRoomInConvex")
    expect(workerConvex).toContain("!access.allowed || !access.projectId")
  })

  it("uses direct principal membership instead of trusted-device fallback", () => {
    const start = workerConvex.indexOf("export async function authorizeSessionRoomInConvex")
    const end = workerConvex.indexOf("export async function validateSessionRoomPrincipalInConvex", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const section = workerConvex.slice(start, end)

    const accessStart = section.indexOf("collaborationSessions:getRoomAccessForServer")
    const accessEnd = section.indexOf("})", accessStart)
    const accessCall = section.slice(accessStart, accessEnd + 2)
    expect(accessCall).toContain("principalId: principal.principalId")
    expect(accessCall).not.toContain("userId:")
    expect(accessCall).not.toContain("deviceId:")
    expect(section).not.toContain("projectTrustedDevices")
  })

  it("has no duplicate collaboration-device registry or legacy Yjs tables", () => {
    expect(schema).not.toContain("collabDevices: defineTable")
    expect(schema).not.toContain("yjsUpdates: defineTable")
    expect(schema).not.toContain("yjsDocuments: defineTable")
    expect(schema).not.toContain("yjsAwareness: defineTable")
    expect(workerConvex).not.toContain("yjs:registerCollabDevice")
  })
})

