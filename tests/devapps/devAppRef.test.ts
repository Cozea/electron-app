import { describe, expect, it } from "vitest"

import { BUILTIN_DEV_APPS } from "@/features/devapps/registry"
import {
  devAppRefsEqual,
  devAppRefsSameApp,
  formatDevAppRef,
  parseDevAppRef,
  refForLaunchSpec,
  resolveBuiltinRef,
  type DevAppRef,
} from "@/features/devapps/registry/ref"
import type { DevAppLaunchSpec } from "@/features/devapps/registry/types"

const PUBLISHED: DevAppLaunchSpec = {
  kind: "publishedDevApp",
  tileType: "orgDevApp",
  ref: "cozea-devapp:org_abc/pub_123@7",
  publicationId: "pub_123",
  organizationId: "org_abc",
  organizationName: "Cozea",
  releaseId: "rel_9",
  releaseVersion: 7,
  name: "Docs",
  framework: "nextjs",
  contentHash: "a".repeat(64),
  entryPath: "server/server.js",
  runtimeKind: "service",
}

describe("DevApp refs — round trip", () => {
  it("round-trips a built-in ref", () => {
    const ref: DevAppRef = { kind: "builtin", appId: "terminal" }
    expect(formatDevAppRef(ref)).toBe("cozea-devapp:builtin/terminal")
    expect(parseDevAppRef(formatDevAppRef(ref))).toEqual(ref)
  })

  it("round-trips a publication ref pinned to a version", () => {
    const ref: DevAppRef = {
      kind: "publication",
      organizationId: "org_abc",
      publicationId: "pub_123",
      version: 7,
    }
    expect(formatDevAppRef(ref)).toBe("cozea-devapp:org_abc/pub_123@7")
    expect(parseDevAppRef(formatDevAppRef(ref))).toEqual(ref)
  })

  it("omits the version marker when following the active release", () => {
    const ref: DevAppRef = {
      kind: "publication",
      organizationId: "org_abc",
      publicationId: "pub_123",
      version: "latest",
    }
    expect(formatDevAppRef(ref)).toBe("cozea-devapp:org_abc/pub_123")
    expect(parseDevAppRef(formatDevAppRef(ref))).toEqual(ref)
  })

  it("round-trips every built-in through its ref", () => {
    for (const manifest of BUILTIN_DEV_APPS) {
      const ref: DevAppRef = { kind: "builtin", appId: manifest.id }
      const parsed = parseDevAppRef(formatDevAppRef(ref))
      expect(parsed, `${manifest.id} failed to round-trip`).toEqual(ref)
      expect(resolveBuiltinRef(parsed!)?.id).toBe(manifest.id)
    }
  })
})

describe("DevApp refs — rejecting malformed input", () => {
  // Refs arrive from persisted state and from agent-authored manifests, so parsing must
  // fail closed rather than produce a ref that addresses something unintended.
  const rejected: Array<[string, string]> = [
    ["", "empty"],
    ["terminal", "no scheme"],
    ["cozea-devapp:", "no body"],
    ["cozea-devapp:builtin", "no separator"],
    ["cozea-devapp:/terminal", "empty owner"],
    ["cozea-devapp:builtin/", "empty id"],
    ["cozea-devapp:builtin/../../etc/passwd", "path traversal"],
    ["cozea-devapp:org_abc/pub_123/extra", "extra segment"],
    ["cozea-devapp:org_abc/pub_123@0", "version below one"],
    ["cozea-devapp:org_abc/pub_123@-4", "negative version"],
    ["cozea-devapp:org_abc/pub_123@latest", "non-numeric version"],
    ["cozea-devapp:org_abc/pub_123@1.5", "fractional version"],
    ["cozea-devapp:builtin/terminal@3", "version on a built-in"],
    ["cozea-devapp:org abc/pub_123", "space in owner"],
    ["https://example.com/evil", "foreign scheme"],
  ]

  for (const [value, why] of rejected) {
    it(`rejects ${why}`, () => {
      expect(parseDevAppRef(value)).toBeNull()
    })
  }

  it("rejects an over-long ref rather than parsing it", () => {
    expect(parseDevAppRef(`cozea-devapp:org_abc/${"p".repeat(600)}`)).toBeNull()
  })

  it("does not resolve a publication ref as a built-in", () => {
    // "builtin" is reserved as an owner so a publication cannot impersonate a
    // first-party app by naming itself one.
    const ref = parseDevAppRef("cozea-devapp:org_abc/terminal")
    expect(ref).toEqual({
      kind: "publication",
      organizationId: "org_abc",
      publicationId: "terminal",
      version: "latest",
    })
    expect(resolveBuiltinRef(ref!)).toBeNull()
  })
})

describe("DevApp refs — identity", () => {
  it("treats different pinned versions as the same app but different refs", () => {
    const v1: DevAppRef = { kind: "publication", organizationId: "o", publicationId: "p", version: 1 }
    const v2: DevAppRef = { ...v1, version: 2 } as DevAppRef
    expect(devAppRefsEqual(v1, v2)).toBe(false)
    expect(devAppRefsSameApp(v1, v2)).toBe(true)
  })

  it("does not conflate a built-in with a publication of the same name", () => {
    const builtin: DevAppRef = { kind: "builtin", appId: "terminal" }
    const published: DevAppRef = {
      kind: "publication",
      organizationId: "org_abc",
      publicationId: "terminal",
      version: "latest",
    }
    expect(devAppRefsEqual(builtin, published)).toBe(false)
    expect(devAppRefsSameApp(builtin, published)).toBe(false)
  })
})

describe("DevApp refs — deriving identity from what already ships", () => {
  it("preserves the originating ref on a materialized publication launch", () => {
    expect(refForLaunchSpec(PUBLISHED)).toEqual({
      kind: "publication",
      organizationId: "org_abc",
      publicationId: "pub_123",
      version: 7,
    })
  })

  it("derives a ref for every built-in launch spec", () => {
    for (const manifest of BUILTIN_DEV_APPS) {
      const ref = refForLaunchSpec(manifest.launch)
      expect(ref, `${manifest.id} produced no ref`).not.toBeNull()
      expect(ref!.kind).toBe("builtin")
    }
  })

  it("produces a ref a caller can store and resolve later without the launch spec", () => {
    const stored = formatDevAppRef(refForLaunchSpec(PUBLISHED)!)
    expect(stored).toBe("cozea-devapp:org_abc/pub_123@7")
    // The whole point: this string alone names the app, with no release id, content
    // hash, or entry path in hand.
    expect(parseDevAppRef(stored)).toBeTruthy()
  })
})

describe("Development refs", () => {
  it("round-trips", () => {
    const ref = { kind: "development", sourceId: "src_9fa2" } as const
    expect(parseDevAppRef(formatDevAppRef(ref))).toEqual(ref)
  })

  it("reserves dev as an owner so a publication cannot claim one", () => {
    // An org literally named "dev" would otherwise be able to publish something that
    // parses as an in-development package, which is trusted on a different footing.
    const parsed = parseDevAppRef("cozea-devapp:dev/pub_1")
    expect(parsed).toEqual({ kind: "development", sourceId: "pub_1" })
  })

  it("refuses a version on a development ref, which has no releases", () => {
    expect(parseDevAppRef("cozea-devapp:dev/src_1@2")).toBeNull()
  })

  it("refuses a malformed source id", () => {
    for (const value of [
      "cozea-devapp:dev/",
      "cozea-devapp:dev/../etc",
      "cozea-devapp:dev/a b",
      "cozea-devapp:dev//x",
      "cozea-devapp:dev/-leading",
    ]) {
      expect(parseDevAppRef(value), value).toBeNull()
    }
  })

  it("is never the same app as a publication or a built-in", () => {
    const development = { kind: "development", sourceId: "terminal" } as const
    expect(devAppRefsSameApp(development, { kind: "builtin", appId: "terminal" })).toBe(false)
    expect(devAppRefsSameApp(development, {
      kind: "publication",
      organizationId: "org_1",
      publicationId: "terminal",
      version: "latest",
    })).toBe(false)
    expect(devAppRefsEqual(development, { kind: "builtin", appId: "terminal" })).toBe(false)
  })

  it("distinguishes two development sources", () => {
    expect(devAppRefsSameApp(
      { kind: "development", sourceId: "a" },
      { kind: "development", sourceId: "b" },
    )).toBe(false)
  })
})
