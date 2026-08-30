import { describe, expect, it } from "vitest"

import { devAppGrantApprovalKey, normalizeGrant } from "../../shared/devAppCapabilities"
import {
  DEVELOPMENT_GRANT_TTL_MS,
  DevAppDevelopmentTrustStore,
  developmentApprovalKey,
  developmentTrustBadge,
} from "../../shared/devAppDevelopmentTrust"

function makeStore(startAt = 1_000_000) {
  let now = startAt
  const store = new DevAppDevelopmentTrustStore(() => now)
  return { store, advance: (ms: number) => { now += ms }, at: () => now }
}

const grant = (capabilities: string[], agentInvocable = false) =>
  normalizeGrant({ capabilities, agentInvocable })

describe("Development trust — never inherits published approval", () => {
  it("computes a key that cannot collide with a published one", () => {
    // A published approval binds a publication and a content hash. A working tree has
    // neither, so the two are kept in namespaces that cannot be made to meet.
    const published = devAppGrantApprovalKey("pub_1", "a".repeat(64), grant(["project.read"]))
    const development = developmentApprovalKey("pub_1", grant(["project.read"]))
    expect(published).not.toBe(development)
    expect(published.startsWith("worker:")).toBe(true)
    expect(development.startsWith("devworker:")).toBe(true)
  })

  it("does not trust a source just because a publication was approved", () => {
    const { store } = makeStore()
    // Nothing about approving a published release reaches this store at all.
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("unapproved")
  })

  it("keeps two sources separate", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.write"]))
    expect(store.resolve("src_2", grant(["project.write"])).status).toBe("unapproved")
  })
})

describe("Development trust — what an app may run with", () => {
  it("runs with what was approved", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.read", "git.read"]))
    const state = store.resolve("src_1", grant(["project.read", "git.read"]))
    expect(state).toMatchObject({ status: "approved" })
    // Sorted, because the normalized set is what gets hashed into the approval.
    expect(state.status === "approved" && state.effective.capabilities)
      .toEqual(["git.read", "project.read"])
  })

  it("runs narrowed when the manifest asks for less, without a new prompt", () => {
    // Least privilege: the effective grant is what is currently asked for, not the wider
    // thing once approved.
    const { store } = makeStore()
    store.approve("src_1", grant(["project.read", "project.write"]))
    const state = store.resolve("src_1", grant(["project.read"]))
    expect(state.status).toBe("approved")
    expect(state.status === "approved" && state.effective.capabilities).toEqual(["project.read"])
  })

  it("asks again when the manifest widens its request", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    const state = store.resolve("src_1", grant(["project.read", "project.write"]))
    expect(state).toMatchObject({ status: "unapproved", missing: ["project.write"] })
  })

  it("asks again when the app newly wants to be agent-invocable", () => {
    // Being driven with nobody watching is its own question, so holding the same
    // capabilities does not answer it.
    const { store } = makeStore()
    store.approve("src_1", grant(["project.write"], false))
    const state = store.resolve("src_1", grant(["project.write"], true))
    expect(state).toMatchObject({ status: "unapproved", needsAgentInvocable: true })
  })

  it("still permits a narrowed request that drops agent invocation", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.write"], true))
    const state = store.resolve("src_1", grant(["project.write"], false))
    expect(state.status).toBe("approved")
    expect(state.status === "approved" && state.effective.agentInvocable).toBe(false)
  })

  it("treats an escalating capability like any other — provisional is not laxer", () => {
    const { store } = makeStore()
    expect(store.resolve("src_1", grant(["terminal.spawn"])))
      .toMatchObject({ status: "unapproved", missing: ["terminal.spawn"] })
  })
})

describe("Development trust — provisional means it goes away", () => {
  it("holds within the window", () => {
    const { store, advance } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    advance(DEVELOPMENT_GRANT_TTL_MS - 1)
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("approved")
  })

  it("expires at the boundary, not after it", () => {
    const { store, advance } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    advance(DEVELOPMENT_GRANT_TTL_MS)
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("expired")
  })

  it("forgets an expired approval rather than reporting it forever", () => {
    const { store, advance } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    advance(DEVELOPMENT_GRANT_TTL_MS)
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("expired")
    // The second look sees no approval at all, which is the state a prompt should reflect.
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("unapproved")
  })

  it("drops expired approvals from the list a settings surface would show", () => {
    const { store, advance } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    store.approve("src_2", grant(["git.read"]))
    expect(store.list()).toHaveLength(2)
    advance(DEVELOPMENT_GRANT_TTL_MS)
    expect(store.list()).toEqual([])
  })

  it("revokes one source without touching the others", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    store.approve("src_2", grant(["project.read"]))
    store.revoke("src_1")
    expect(store.resolve("src_1", grant(["project.read"])).status).toBe("unapproved")
    expect(store.resolve("src_2", grant(["project.read"])).status).toBe("approved")
  })

  it("revokes everything at once", () => {
    const { store } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    store.approve("src_2", grant(["project.read"]))
    store.revokeAll()
    expect(store.list()).toEqual([])
  })

  it("carries no state that could survive a restart", () => {
    // A fresh store is the whole persistence model: nothing is written anywhere, so a
    // directory trusted while iterating is not trusted again by default tomorrow.
    const first = makeStore().store
    first.approve("src_1", grant(["project.write"]))
    const second = new DevAppDevelopmentTrustStore(() => 1_000_000)
    expect(second.resolve("src_1", grant(["project.write"])).status).toBe("unapproved")
  })
})

describe("Development badge", () => {
  it("always reads as development, whatever the trust state", () => {
    const { store } = makeStore()
    const unapproved = developmentTrustBadge(store.resolve("src_1", grant(["project.read"])))
    store.approve("src_1", grant(["project.read"]))
    const approved = developmentTrustBadge(store.resolve("src_1", grant(["project.read"])))
    expect(unapproved.tone).toBe("development")
    expect(approved.tone).toBe("development")
    expect(approved.label).toBe("Development")
  })

  it("says plainly when nothing was granted", () => {
    const { store } = makeStore()
    store.approve("src_1", grant([]))
    const badge = developmentTrustBadge(store.resolve("src_1", grant([])))
    expect(badge.detail).toContain("not been granted")
  })

  it("tells the user when the approval lapsed rather than looking normal", () => {
    const { store, advance } = makeStore()
    store.approve("src_1", grant(["project.read"]))
    advance(DEVELOPMENT_GRANT_TTL_MS)
    expect(developmentTrustBadge(store.resolve("src_1", grant(["project.read"]))).detail)
      .toContain("expired")
  })
})
