import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()
const workerSession = fs.readFileSync(
  path.join(root, "cloudflare/worker/src/routes/collabSession.ts"),
  "utf8",
)
const workerConvex = fs.readFileSync(
  path.join(root, "cloudflare/worker/src/lib/convex.ts"),
  "utf8",
)
const yjs = fs.readFileSync(path.join(root, "convex/yjs.ts"), "utf8")
const yjsContext = fs.readFileSync(
  path.join(root, "apps/desktop/src/contexts/YjsProjectContext.tsx"),
  "utf8",
)

function exportedSection(name: string, nextName: string): string {
  const start = yjs.indexOf(`export const ${name}`)
  const end = yjs.indexOf(`export const ${nextName}`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return yjs.slice(start, end)
}

describe("collaboration authority boundary", () => {
  it("requires a device bearer and fails closed on project access", () => {
    expect(workerSession).toContain("Device authentication is required")
    expect(workerSession).toContain("verifyDeviceAccessToken")
    expect(workerConvex).toContain("auth.sub !== body.deviceId")
    expect(workerConvex).toContain("!access.canAccess || !access.canEdit")
    expect(workerConvex).toContain("The authenticated device cannot access this project")
  })

  it("requires an explicit matching request before sharing a wrapped room key", () => {
    const section = exportedSection("storeWrappedRoomKey", "storeRecoveryKit")
    expect(section).toContain("canManageProject")
    expect(section).toContain("matching pending key request is required")
    expect(section).toContain("pendingRequest.recipientUserId !== args.recipientUserId")
  })

  it("keeps project revocation scoped and manager-only", () => {
    const section = exportedSection("revokeCollabDevice", "rotateEncryptedRoomKey")
    expect(section).toContain("canManageProject")
    expect(section).toContain('query("projectCollabWrappedKeys")')
    expect(section).not.toContain('query("collabDevices")')
    expect(section).not.toContain("ctx.db.patch(device._id")
  })

  it("does not auto-approve pending key requests from the live collaboration context", () => {
    expect(yjsContext).not.toContain("listPendingKeyRequests")
    expect(yjsContext).not.toContain("storeWrappedRoomKey")
  })
})
