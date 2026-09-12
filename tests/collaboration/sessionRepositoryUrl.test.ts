import { describe, expect, it } from "vitest"

import { describeSessionRepository, normalizeSessionRepositoryUrl } from "../../shared/collaboration/repositoryUrl"

/**
 * The remote a session records is cloned by every invitee's Mac, so it must be a
 * validated network remote and nothing Git could read as an option.
 */

describe("session repository URLs", () => {
  it("keeps validated network remotes exactly, including sign-in details the UI warns about", () => {
    expect(normalizeSessionRepositoryUrl("https://github.com/acme/app.git")).toBe("https://github.com/acme/app.git")
    expect(normalizeSessionRepositoryUrl("https://ghp_secret@github.com/acme/app.git")).toBe(
      "https://ghp_secret@github.com/acme/app.git",
    )
    expect(normalizeSessionRepositoryUrl("https://user:pass@github.com/acme/app.git?x=1#y")).toBe(
      "https://user:pass@github.com/acme/app.git?x=1#y",
    )
    expect(normalizeSessionRepositoryUrl("ssh://git:pw@github.com/acme/app.git")).toBe(
      "ssh://git:pw@github.com/acme/app.git",
    )
    expect(normalizeSessionRepositoryUrl("git@github.com:acme/app.git")).toBe("git@github.com:acme/app.git")
    expect(normalizeSessionRepositoryUrl("  https://github.com/acme/app  ")).toBe("https://github.com/acme/app")
  })

  it("refuses remotes another Mac cannot or should not clone", () => {
    const refused = [
      "",
      "   ",
      null,
      undefined,
      "/Users/me/app",
      "file:///Users/me/app",
      "http://example.com/app.git",
      "ext::sh -c touch% /tmp/x",
      "ext::sh",
      "--upload-pack=touch /tmp/x",
      "-oProxyCommand=x@host:path",
      "git@-oProxyCommand=x:path",
      "https://-evil.example/app.git",
      "https://github.com/acme/app\n.git",
      "https://",
    ]
    for (const raw of refused) {
      expect(normalizeSessionRepositoryUrl(raw), String(raw)).toBeNull()
    }
  })

  it("never sets URL parts, which the Convex runtime does not implement", () => {
    const parts = ["username", "password", "search", "hash"] as const
    const originals = parts.map((part) => [part, Object.getOwnPropertyDescriptor(URL.prototype, part)!] as const)
    try {
      for (const [part, descriptor] of originals) {
        Object.defineProperty(URL.prototype, part, {
          ...descriptor,
          set() {
            throw new Error(`Not implemented: set ${part} for URL`)
          },
        })
      }
      expect(normalizeSessionRepositoryUrl("https://user:pass@github.com/acme/app.git?x=1#y")).toBe(
        "https://user:pass@github.com/acme/app.git?x=1#y",
      )
      expect(normalizeSessionRepositoryUrl("ssh://git:pw@github.com/acme/app.git")).toBe(
        "ssh://git:pw@github.com/acme/app.git",
      )
    } finally {
      for (const [part, descriptor] of originals) Object.defineProperty(URL.prototype, part, descriptor)
    }
  })

  it("describes a remote as host and path", () => {
    expect(describeSessionRepository("https://github.com/acme/app.git")).toBe("github.com/acme/app")
    expect(describeSessionRepository("git@github.com:acme/app.git")).toBe("github.com/acme/app")
    expect(describeSessionRepository("ssh://git@example.com:2222/team/app.git")).toBe("example.com:2222/team/app")
  })
})
