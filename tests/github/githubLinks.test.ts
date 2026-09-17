import { beforeEach, describe, expect, it } from "vitest"

import * as links from "../../convex/githubLinks"
import { FakeConvexDb, fakeConvexCtx, runConvexHandler } from "../helpers/fakeConvexCtx"

/**
 * Behaviour of convex/githubLinks.ts: which repositories count as linked, and how
 * a link is revoked, against an in-memory Convex ctx.
 */

const IDENTITY_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

function seedDevice(db: FakeConvexDb, seed: number) {
  let identityKey = "czd_"
  for (let i = 0; i < 26; i += 1) identityKey += IDENTITY_ALPHABET[(seed * 7 + i * 13) % IDENTITY_ALPHABET.length]
  const id = db.seed("devicePrincipals", {
    identityKey,
    displayName: `Device ${seed}`,
    platform: "darwin",
    encryptionPublicKeyJwk: "{}",
    encryptionPublicKeyAlgorithm: "ECDH-P256",
    encryptionFingerprint: `enc-${seed}`,
    signingPublicKeyJwk: "{}",
    signingPublicKeyAlgorithm: "ECDSA-P256-SHA256",
    signingFingerprint: `sig-${seed}`,
    status: "active",
    signingKeyVersion: 1,
    tokenValidAfter: 0,
  })
  return { id, ctx: fakeConvexCtx(db, { subject: identityKey, key_version: 1, token_issued_at: Math.floor(Date.now() / 1000) }) }
}

const REPO_URL = "https://github.com/Team/App.git"

let db: FakeConvexDb
let owner: ReturnType<typeof seedDevice>
let viewer: ReturnType<typeof seedDevice>
let projectId: string
let internalCtx: ReturnType<typeof fakeConvexCtx>

beforeEach(() => {
  db = new FakeConvexDb()
  owner = seedDevice(db, 1)
  viewer = seedDevice(db, 2)
  projectId = db.seed("projects", {
    name: "Demo",
    status: "active",
    createdBy: owner.id,
    repo: { provider: "github", url: REPO_URL, defaultBranch: "main" },
  })
  db.seed("projectMembers", { projectId, principalId: viewer.id, role: "viewer" })
  internalCtx = fakeConvexCtx(db, null)
})

async function installAndLink(installationId = 7) {
  await runConvexHandler(links.upsertInstallation, internalCtx, {
    installationId, accountId: 1, accountLogin: "Team", accountType: "Organization", repositorySelection: "selected", suspended: false,
  })
  await runConvexHandler(links.saveGrant, internalCtx, {
    projectId, owner: "Team", name: "App", repositoryUrl: REPO_URL, repositoryId: 99, installationId, linkedByPrincipalId: owner.id,
  })
}

describe("which repositories session tokens may be issued for", () => {
  it("counts a grant only while its installation is usable", async () => {
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()
    await installAndLink()
    // GitHub treats owner and name case-insensitively; so does the lookup.
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: "git@github.com:team/app.git" }))
      .toMatchObject({ installationId: 7, repositoryId: 99, allowGitWrite: true })

    await runConvexHandler(links.setInstallationSuspended, internalCtx, { installationId: 7, suspended: true })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()
    await runConvexHandler(links.setInstallationSuspended, internalCtx, { installationId: 7, suspended: false })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).not.toBeNull()
  })

  it("revokes grants when the app is uninstalled or the repository is taken out of it", async () => {
    await installAndLink()
    await runConvexHandler(links.revokeRepositories, internalCtx, { installationId: 8, repositoryIds: [99] })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).not.toBeNull()
    await runConvexHandler(links.revokeRepositories, internalCtx, { installationId: 7, repositoryIds: [99] })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()

    await installAndLink()
    await runConvexHandler(links.removeInstallation, internalCtx, { installationId: 7 })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()
    // Installing again doesn't bring back a link someone has to make deliberately.
    await runConvexHandler(links.upsertInstallation, internalCtx, {
      installationId: 7, accountId: 1, accountLogin: "Team", accountType: "Organization", repositorySelection: "all", suspended: false,
    })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()
  })

  it("keeps one active grant per project repository when it is linked again", async () => {
    await installAndLink(7)
    await installAndLink(8)
    const active = db.rows("githubRepositoryGrants").filter((grant) => grant.revokedAt === undefined)
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ installationId: 8 })
  })
})

describe("the round trip to GitHub", () => {
  it("accepts a state once, and never after it expires", async () => {
    await runConvexHandler(links.createLinkRequest, internalCtx, { state: "fresh", principalId: owner.id, projectId })
    expect(await runConvexHandler(links.consumeLinkRequest, internalCtx, { state: "fresh" })).toEqual({ principalId: owner.id, projectId })
    expect(await runConvexHandler(links.consumeLinkRequest, internalCtx, { state: "fresh" })).toBeNull()
    expect(await runConvexHandler(links.consumeLinkRequest, internalCtx, { state: "unknown" })).toBeNull()

    db.seed("githubLinkRequests", { state: "stale", principalId: owner.id, createdAt: 0, expiresAt: Date.now() - 1 })
    expect(await runConvexHandler(links.consumeLinkRequest, internalCtx, { state: "stale" })).toBeNull()
  })
})

describe("what a project member sees", () => {
  it("reports the owner's installation, the link, and who may link", async () => {
    const before = await runConvexHandler(links.projectRepositoryStatus, owner.ctx, { projectId })
    expect(before).toMatchObject({ repository: { owner: "Team", name: "App" }, linked: false, installation: null, account: null, canLink: true })

    await runConvexHandler(links.saveAccount, internalCtx, { principalId: viewer.id, githubUserId: 5, login: "viewer-gh" })
    await installAndLink()
    expect(await runConvexHandler(links.projectRepositoryStatus, viewer.ctx, { projectId })).toMatchObject({
      linked: true,
      gitWrite: true,
      installation: { installationId: 7, accountLogin: "Team" },
      account: { login: "viewer-gh" },
      canLink: false,
    })
  })

  it("lets only a project manager unlink", async () => {
    await installAndLink()
    await expect(runConvexHandler(links.unlinkRepository, viewer.ctx, { projectId })).rejects.toThrow()
    await runConvexHandler(links.unlinkRepository, owner.ctx, { projectId })
    expect(await runConvexHandler(links.grantFor, internalCtx, { projectId, repositoryUrl: REPO_URL })).toBeNull()
  })

  it("lists the repositories this device linked and forgets its GitHub account on request", async () => {
    await runConvexHandler(links.saveAccount, internalCtx, { principalId: owner.id, githubUserId: 5, login: "team" })
    await installAndLink()
    expect(await runConvexHandler(links.settings, owner.ctx, {})).toMatchObject({
      account: { login: "team" },
      installations: [{ installationId: 7, accountLogin: "Team" }],
      repositories: [{ projectName: "Demo", owner: "Team", name: "App", gitWrite: true, usable: true }],
    })
    await runConvexHandler(links.disconnectAccount, owner.ctx, {})
    expect((await runConvexHandler(links.settings, owner.ctx, {})).account).toBeNull()
  })
})
