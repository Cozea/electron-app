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
const schema = fs.readFileSync(path.join(root, "convex/schema.ts"), "utf8")
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
    expect(workerConvex).toContain("!access.canAccess || !access.canEdit")
    expect(workerConvex).toContain("The authenticated device cannot access this project")
  })

  it("uses direct principal membership instead of trusted-device fallback", () => {
    const start = workerConvex.indexOf("export async function createCollabSessionFromConvex")
    const end = workerConvex.indexOf("export async function fetchYjsDeltasFromConvex", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const section = workerConvex.slice(start, end)

    const accessStart = section.indexOf("projectMembers:getProjectAccessForServer")
    const accessEnd = section.indexOf("})", accessStart)
    const accessCall = section.slice(accessStart, accessEnd + 2)
    expect(accessCall).toContain("userId: principal.principalId")
    expect(accessCall).not.toContain("deviceId:")
    expect(section).not.toContain("projectTrustedDevices")
  })

  it("has no duplicate collaboration-device registry", () => {
    expect(schema).not.toContain("collabDevices: defineTable")
    expect(yjs).not.toContain('query("collabDevices")')
    expect(workerConvex).not.toContain("yjs:registerCollabDevice")
    expect(workerConvex).toContain("principal.encryptionPublicKeyJwk")
    expect(workerConvex).toContain("principal.encryptionFingerprint")
  })

  it("requires an explicit matching request before sharing a wrapped room key", () => {
    const section = exportedSection("storeWrappedRoomKey", "storeRecoveryKit")
    expect(section).toContain("canManageProject")
    expect(section).toContain("matching pending key request is required")
    expect(section).toContain("keyRequestId")
    expect(section).toContain("recipient.encryptionPublicKeyJwk !== pendingRequest.recipientPublicKeyJwk")
    expect(section).toContain("principal.encryptionPublicKeyJwk")
  })

  it("keeps project revocation scoped and manager-only", () => {
    const section = exportedSection("revokeCollabDevice", "rotateEncryptedRoomKey")
    expect(section).toContain("canManageProject")
    expect(section).toContain('query("projectCollabWrappedKeys")')
    expect(section).not.toContain('query("collabDevices")')
  })

  it("does not auto-approve pending key requests from the live collaboration context", () => {
    expect(yjsContext).not.toContain("listPendingKeyRequests")
    expect(yjsContext).not.toContain("storeWrappedRoomKey")
  })
})
