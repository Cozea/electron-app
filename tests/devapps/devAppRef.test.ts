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
  it("gives an already-persisted published tile an addressable identity", () => {
    // This is what lets existing workbench state gain a durable handle with no migration.
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
