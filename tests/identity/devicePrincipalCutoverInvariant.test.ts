import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8")

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("device-principal cutover invariants", () => {
  it("has one canonical principal table with no account-era profile identity", () => {
    const schema = read("convex/schema.ts")
    const principalTable = section(
      schema,
      "devicePrincipals: defineTable({",
      "deviceAuthChallenges: defineTable({",
    )

    expect(schema).not.toContain("users: defineTable({")
    expect(schema).not.toContain("projectTrustedDevices: defineTable({")
    expect(schema).not.toContain("collabDevices: defineTable({")
    expect(schema).not.toContain("projectInvites: defineTable({")
    expect(principalTable).toContain("identityKey: v.string()")
    expect(principalTable).toContain("displayName: v.string()")
    expect(principalTable).toContain('avatarStorageId: v.optional(v.id("_storage"))')

    for (const legacyField of [
      "workosId:",
      "email:",
      "normalizedEmail:",
      "firstName:",
      "lastName:",
      "profileImageUrl:",
      "jobTitle:",
      "emailNotifications:",
    ]) {
      expect(principalTable).not.toContain(legacyField)
    }
  })

  it("stores local identity as cryptographic machine identity, not OS presentation", () => {
    const collabKeys = read("apps/desktop/electron/collabKeys.ts")
    const storedIdentity = section(
      collabKeys,
      "interface StoredCollabDeviceIdentity {",
      "export interface CollabDeviceIdentity {",
    )
    const publicIdentity = section(
      collabKeys,
      "export interface CollabDeviceIdentity {",
      "export interface CollabDeviceChallengeSignature {",
    )

    expect(collabKeys).not.toContain("node:os")
    expect(storedIdentity).toContain("schemaVersion: 3")
    expect(storedIdentity).toContain("identityKey: string")
    expect(storedIdentity).not.toContain("deviceLabel")
    expect(storedIdentity).not.toContain("deviceId")
    expect(storedIdentity).not.toContain("userId")
    expect(publicIdentity).toContain("identityKey: string")
    expect(publicIdentity).not.toContain("deviceLabel")
    expect(publicIdentity).not.toContain("deviceId")
    expect(publicIdentity).not.toContain("userId")
  })

  it("keeps auth and collaboration transport alias-free", () => {
    const workerTypes = read("cloudflare/worker/src/types.ts")
    const challenge = section(
      workerTypes,
      "export interface DeviceAuthChallengeRequest {",
      "export interface DeviceAuthChallengeClaims",
    )
    const accessClaims = section(
      workerTypes,
      "export interface DeviceAccessClaims {",
      "export interface SessionDescriptor {",
    )
    const sessionRequest = section(
      workerTypes,
      "export interface SessionRequestBody {",
      "export interface DeviceAuthChallengeRequest {",
    )

    expect(challenge).not.toContain("deviceLabel")
    expect(accessClaims).not.toContain("device_id")
    expect(sessionRequest).toContain("projectId: string")
    expect(sessionRequest).toContain("clientType: 'web' | 'electron'")
    expect(sessionRequest).not.toContain("identityKey")
    expect(sessionRequest).not.toContain("deviceId")
    expect(sessionRequest).not.toContain("publicKeyJwk")
  })

  it("has removed email-keyed invitation modules and hostname-era publisher naming", () => {
    expect(existsSync(join(root, "convex/projectInvites.ts"))).toBe(false)
    expect(existsSync(join(root, "convex/organizationInvites.ts"))).toBe(false)
    expect(existsSync(join(root, "apps/desktop/src/features/projects/pages/ProjectInvitePage.tsx"))).toBe(false)

    const schema = read("convex/schema.ts")
    expect(schema).toContain("publisherDisplayName")
    expect(schema).not.toContain("publisherDisplayName")
  })

  it("exposes only machine-principal presentation in shared session identity", () => {
    const sharedTypes = read("shared/types.ts")
    const identity = section(sharedTypes, "export interface User {", "export type WorkspaceType")

    for (const field of ["principalId", "identityKey", "displayName", "avatarUrl", "platform"]) {
      expect(identity).toContain(`${field}:`)
    }
    for (const accountField of ["email:", "firstName:", "lastName:", "profileImageUrl:"]) {
      expect(identity).not.toContain(accountField)
    }
  })
})
