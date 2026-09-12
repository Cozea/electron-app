import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { SessionPullRequestStore } from "../../apps/projectd/src/autogit/SessionPullRequestStore"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

const sessionId = "czs_0123456789abcdef"
const repository = "team/app"
const branch = "feat/live"
const targetBranch = "main"

function record(overrides: Partial<Parameters<SessionPullRequestStore["save"]>[0]> = {}) {
  return {
    publicSessionId: sessionId,
    repository,
    branch,
    targetBranch,
    number: 12,
    url: "https://github.com/team/app/pull/12",
    state: "open" as const,
    headOid: "a".repeat(40),
    targetOid: "b".repeat(40),
    checkedAt: 1_760_000_000_000,
    ...overrides,
  }
}

describe("SessionPullRequestStore", () => {
  const paths: string[] = []

  afterEach(() => {
    for (const dbPath of paths.splice(0)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { fs.rmSync(dbPath + suffix, { force: true }) } catch { /* ignore */ }
      }
    }
  })

  it("persists status across daemon database reopen and updates one branch identity in place", () => {
    const dbPath = path.join(os.tmpdir(), `cozea-pr-store-${crypto.randomUUID()}.sqlite`)
    paths.push(dbPath)
    let db = new ProjectdDatabase(dbPath)
    let store = new SessionPullRequestStore(db)
    store.save(record())
    db.close()

    db = new ProjectdDatabase(dbPath)
    store = new SessionPullRequestStore(db)
    expect(store.get(sessionId, repository, branch, targetBranch)).toEqual(record())

    const merged = record({ state: "merged", headOid: "c".repeat(40), targetOid: "d".repeat(40), checkedAt: 1_760_000_001_000 })
    store.save(merged)
    expect(store.get(sessionId, repository, branch, targetBranch)).toEqual(merged)
    expect(store.list(sessionId)).toEqual([merged])
    db.close()
  })

  it("keeps independent repository/branch targets separate", () => {
    const db = new ProjectdDatabase(":memory:")
    const store = new SessionPullRequestStore(db)
    const first = record()
    const second = record({ repository: "team/other", number: 21, url: "https://github.com/team/other/pull/21" })
    store.save(first)
    store.save(second)
    expect(store.list(sessionId)).toHaveLength(2)
    expect(store.get(sessionId, repository, branch, targetBranch)).toEqual(first)
    expect(store.get(sessionId, "team/other", branch, targetBranch)).toEqual(second)
    db.close()
  })

  it("refuses corrupt identifiers instead of persisting ambiguous status", () => {
    const db = new ProjectdDatabase(":memory:")
    const store = new SessionPullRequestStore(db)
    expect(() => store.save(record({ number: 0 }))).toThrow("number")
    expect(() => store.save(record({ url: "https://evil.example/team/app/pull/12" }))).toThrow("metadata")
    expect(() => store.save(record({ headOid: "not-an-oid" }))).toThrow("metadata")
    expect(store.list(sessionId)).toEqual([])
    db.close()
  })
})
