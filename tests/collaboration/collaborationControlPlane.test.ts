import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schemaSource = fs.readFileSync(
  path.join(root, "convex/schema/collaboration.ts"),
  "utf8",
)
const apiSource = fs.readFileSync(
  path.join(root, "convex/collaborationSessions.ts"),
  "utf8",
)
const schemaEntrySource = fs.readFileSync(
  path.join(root, "convex/schema.ts"),
  "utf8",
)

function exportedSection(name: string, nextName: string): string {
  const start = apiSource.indexOf(`export const ${name}`)
  const end = apiSource.indexOf(`export const ${nextName}`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return apiSource.slice(start, end)
}

describe("collaboration v2 control-plane boundaries", () => {
  it("keeps collaboration tables in an owned schema module", () => {
    expect(schemaEntrySource).toContain('import baseSchema from "./schema/base"')
    expect(schemaEntrySource).toContain('import { collaborationTables } from "./schema/collaboration"')
    expect(schemaEntrySource).toContain("...baseSchema.tables")
    expect(schemaEntrySource).toContain("...collaborationTables")

    expect(schemaSource).toContain("collaborationSessions: defineTable")
    expect(schemaSource).toContain("collaborationParticipants: defineTable")
    expect(schemaSource).toContain("collaborationSessionEvents: defineTable")
  })

  it("stores control metadata without source trees, Yjs bytes, or Git credentials", () => {
    expect(schemaSource).not.toMatch(/sourceCode\s*:/)
    expect(schemaSource).not.toMatch(/fileContents?\s*:/)
    expect(schemaSource).not.toMatch(/yjsUpdate\s*:/)
    expect(schemaSource).not.toMatch(/snapshot\s*:/)
    expect(schemaSource).not.toMatch(/ciphertext\s*:/)
    expect(schemaSource).not.toMatch(/accessToken\s*:/)
    expect(schemaSource).not.toMatch(/installationToken\s*:/)
    expect(schemaSource).not.toMatch(/privateKey\s*:/)
  })

  it("requires the machine-backed authenticated user for public operations", () => {
    const publicOperations = [
      ["createSession", "activateSession"],
      ["activateSession", "getSession"],
      ["getSession", "listForProject"],
      ["listForProject", "joinSession"],
      ["joinSession", "heartbeatParticipant"],
      ["heartbeatParticipant", "leaveSession"],
      ["leaveSession", "listParticipants"],
      ["listParticipants", "acquireCommitLease"],
      ["acquireCommitLease", "renewCommitLease"],
      ["renewCommitLease", "markLocalCommitReady"],
      ["markLocalCommitReady", "beginPush"],
      ["beginPush", "releaseCommitLease"],
    ] as const

    for (const [name, nextName] of publicOperations) {
      expect(exportedSection(name, nextName)).toContain("requireAuthenticatedDevice(ctx)")
    }
  })

  it("keeps room sequence and published-base advancement behind the gateway secret", () => {
    const roomHead = exportedSection(
      "updateRoomHeadFromServer",
      "advancePublishedBaseFromServer",
    )
    const publication = exportedSection(
      "advancePublishedBaseFromServer",
      "closeSession",
    )

    expect(roomHead).toContain("assertGatewaySecret(args.serverSecret)")
    expect(publication).toContain("assertGatewaySecret(args.serverSecret)")
    expect(publication).toContain("advancePublishedCollaborationBase")
    expect(publication).not.toContain("requireAuthenticatedDevice(ctx)")
  })

  it("does not let a public mutation claim that a Git push succeeded", () => {
    expect(apiSource).toContain("export const beginPush")
    expect(apiSource).not.toContain("export const advancePublishedBase = mutation")
    expect(apiSource).not.toContain("export const completePush = mutation")
  })

  it("makes session creation idempotent and prevents two live sessions per target", () => {
    const create = exportedSection("createSession", "activateSession")
    expect(create).toContain("by_project_and_creation_token")
    expect(create).toContain("Creation token was already used")
    expect(create).toContain("by_project_and_target")
    expect(create).toContain("active_session_exists")
  })

  it("supports recovery after an expired commit preparation without stealing an active lease", () => {
    const acquire = exportedSection("acquireCommitLease", "renewCommitLease")
    expect(acquire).toContain("commit_lease_held")
    expect(acquire).toContain("RECOVERABLE_EXPIRED_LEASE_STATUSES")
    expect(acquire).toContain("recoveredExpiredLease")
    expect(acquire).toContain("pendingCommitSha: undefined")
  })

  it("records a prepared local commit separately from the published base", () => {
    const prepared = exportedSection("markLocalCommitReady", "beginPush")
    expect(prepared).toContain("pendingCommitSha")
    expect(prepared).toContain("pendingCommitThroughSequence")
    expect(prepared).toContain('status: "local_commit_ready"')
    expect(prepared).not.toContain("baseCommitSha:")
    expect(prepared).not.toContain("publishedCommitSha:")
  })
})
