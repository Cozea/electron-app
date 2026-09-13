import { describe, expect, it } from "vitest"

import { normalizeSessionRepositoryUrl, remoteCarriesCredentials } from "@shared/collaboration/repositoryUrl"

/**
 * A remote with a token in its URL is the person's to fix: Cozea warns before sharing
 * the configured remote and never silently rewrites their Git config.
 */
describe("remotes that carry sign-in details", () => {
  it("spots a token or password in the URL", () => {
    expect(remoteCarriesCredentials("https://ghp_0123456789@github.com/team/app.git")).toBe(true)
    expect(remoteCarriesCredentials("https://someone:secret@git.example.com/team/app.git")).toBe(true)
    expect(remoteCarriesCredentials("ssh://git:secret@git.example.com/team/app.git")).toBe(true)
  })

  it("leaves ordinary remotes alone, the SSH login included", () => {
    expect(remoteCarriesCredentials("https://github.com/team/app.git")).toBe(false)
    expect(remoteCarriesCredentials("git@github.com:team/app.git")).toBe(false)
    expect(remoteCarriesCredentials("ssh://git@github.com/team/app.git")).toBe(false)
    expect(remoteCarriesCredentials(null)).toBe(false)
    expect(remoteCarriesCredentials("not a url")).toBe(false)
  })

  it("preserves the configured remote so the warning is an explicit product decision", () => {
    expect(normalizeSessionRepositoryUrl("https://ghp_0123456789@github.com/team/app.git")).toBe(
      "https://ghp_0123456789@github.com/team/app.git",
    )
  })
})
