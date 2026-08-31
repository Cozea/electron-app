import { describe, expect, it } from "vitest"

import {
  DEV_APP_MANIFEST_VERSION,
  parseDevAppPackage,
  requestedGrant,
  type DevAppPackageDiagnosticCode,
} from "../../shared/devAppPackage"

const valid = {
  manifestVersion: 1,
  name: "Inventory Console",
  view: { entry: "dist/index.html" },
}

const parse = (value: unknown) => parseDevAppPackage(JSON.stringify(value))

const codes = (result: ReturnType<typeof parse>): DevAppPackageDiagnosticCode[] =>
  result.diagnostics.map((diagnostic) => diagnostic.code)

const blockers = (result: ReturnType<typeof parse>) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "blocker")

describe("DevApp manifest — the happy path", () => {
  it("reads a view-only package", () => {
    const result = parse(valid)
    expect(result.diagnostics).toEqual([])
    expect(result.manifest).toEqual({
      manifestVersion: 1,
      name: "Inventory Console",
      view: { entry: "dist/index.html" },
    })
  })

  it("reads every part together", () => {
    const result = parse({
      ...valid,
      description: "Stock levels at a glance",
      worker: {
        entry: "worker/index.js",
        capabilities: ["project.read", "git.read"],
        exposesTools: true,
      },
      service: { runtimeKind: "node", entry: "server.js" },
    })
    expect(blockers(result)).toEqual([])
    expect(result.manifest?.worker?.capabilities).toEqual(["project.read", "git.read"])
    expect(result.manifest?.service).toEqual({ runtimeKind: "node", entry: "server.js" })
  })

  it("trims the name and defaults exposesTools to false", () => {
    const result = parse({
      ...valid,
      name: "  Spaced  ",
      worker: { entry: "w.js", capabilities: [] },
    })
    expect(result.manifest?.name).toBe("Spaced")
    expect(result.manifest?.worker?.exposesTools).toBe(false)
  })

  it("drops a duplicated capability rather than asking for it twice", () => {
    const result = parse({
      ...valid,
      worker: { entry: "w.js", capabilities: ["project.read", "project.read"] },
    })
    expect(result.manifest?.worker?.capabilities).toEqual(["project.read"])
  })
})

describe("DevApp manifest — fails closed", () => {
  it("refuses a capability it does not recognise instead of dropping it", () => {
    // Dropping it would let the app install asking for less than it does, and the
    // approval prompt would under-report what it can do.
    const result = parse({
      ...valid,
      worker: { entry: "w.js", capabilities: ["project.read", "fs.destroy"] },
    })
    expect(codes(result)).toContain("manifest-unknown-capability")
    expect(result.manifest).toBeNull()
  })

  it("refuses a capability name borrowed from the prototype chain", () => {
    const result = parse({
      ...valid,
      worker: { entry: "w.js", capabilities: ["constructor", "toString", "__proto__"] },
    })
    expect(result.manifest).toBeNull()
    expect(codes(result).filter((code) => code === "manifest-unknown-capability")).toHaveLength(3)
  })

  it("returns no manifest whenever anything blocks", () => {
    const result = parse({ manifestVersion: 1, name: "", view: { entry: "a.html" } })
    expect(result.manifest).toBeNull()
  })

  it("refuses a manifest version it cannot fully understand", () => {
    const result = parse({ ...valid, manifestVersion: DEV_APP_MANIFEST_VERSION + 1 })
    expect(codes(result)).toContain("manifest-version-unsupported")
    expect(result.manifest).toBeNull()
  })

  it("reports unparsable JSON as its own code, not a crash", () => {
    const result = parseDevAppPackage("{ not json")
    expect(codes(result)).toEqual(["manifest-unparsable"])
  })

  it("refuses a manifest that is not an object", () => {
    for (const source of ["[]", '"a string"', "42", "null"]) {
      expect(codes(parseDevAppPackage(source)), source).toEqual(["manifest-not-object"])
    }
  })

  it("refuses a package with no parts at all", () => {
    expect(codes(parse({ manifestVersion: 1, name: "Nothing" }))).toContain("manifest-no-parts")
  })
})

describe("DevApp manifest — paths stay inside the package", () => {
  const rejected = [
    "../outside.html",
    "dist/../../escape.html",
    "/etc/passwd",
    "\\\\server\\share\\a.html",
    "C:\\Windows\\a.html",
    "",
    ".",
    "..",
  ]

  it("refuses an entry that names anything outside the package", () => {
    for (const entry of rejected) {
      const result = parse({ ...valid, view: { entry } })
      expect(result.manifest, entry).toBeNull()
      expect(codes(result), entry).toContain("manifest-path-escapes-package")
    }
  })

  it("refuses a traversal that would end up level again", () => {
    // `a/../../b` never leaves on balance but does leave partway, which is enough.
    expect(parse({ ...valid, view: { entry: "a/../../b.html" } }).manifest).toBeNull()
  })

  it("allows a normal nested path", () => {
    expect(parse({ ...valid, view: { entry: "build/client/index.html" } }).manifest).not.toBeNull()
  })

  it("refuses a path containing a null byte", () => {
    expect(parse({ ...valid, view: { entry: "dist/a\0.html" } }).manifest).toBeNull()
  })

  it("applies the same rule to worker and service entries", () => {
    expect(parse({ ...valid, worker: { entry: "../w.js", capabilities: [] } }).manifest).toBeNull()
    expect(parse({ ...valid, service: { runtimeKind: "node", entry: "/srv.js" } }).manifest)
      .toBeNull()
  })
})

describe("DevApp manifest — the development view URL", () => {
  it("accepts a loopback dev server", () => {
    for (const url of ["http://localhost:5173", "http://127.0.0.1:3000/", "http://[::1]:8080"]) {
      const result = parse({ ...valid, view: { entry: "dist/index.html", dev: { url } } })
      expect(result.manifest?.view?.dev?.url, url).toBe(url)
    }
  })

  it("refuses a remote origin", () => {
    // The preview tile loads this. A manifest that could name any origin would make
    // opening a project enough to load someone else's content as the user's own app.
    for (const url of [
      "https://evil.example.com",
      "http://evil.example.com",
      "file:///etc/passwd",
      "http://localhost.evil.com",
      "javascript:alert(1)",
    ]) {
      const result = parse({ ...valid, view: { entry: "dist/index.html", dev: { url } } })
      expect(result.manifest, url).toBeNull()
    }
  })

  it("refuses https even on loopback, since the dev origin is plain http", () => {
    expect(parse({ ...valid, view: { entry: "a.html", dev: { url: "https://localhost:5173" } } })
      .manifest).toBeNull()
  })
})

describe("DevApp manifest — forward compatibility", () => {
  it("warns about an unknown field but still reads the package", () => {
    const result = parse({ ...valid, futureThing: { enabled: true } })
    expect(result.manifest).not.toBeNull()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "manifest-unknown-field", severity: "warning" }),
    ])
  })

  it("warns that a static service has nothing to run", () => {
    const result = parse({ ...valid, service: { runtimeKind: "static", entry: "server.js" } })
    expect(result.manifest?.service).toEqual({ runtimeKind: "static" })
    expect(blockers(result)).toEqual([])
  })
})

describe("Requested grant", () => {
  it("is what the package asks for, not what it holds", () => {
    const result = parse({
      ...valid,
      worker: { entry: "w.js", capabilities: ["project.read"], exposesTools: true },
    })
    expect(requestedGrant(result.manifest!)).toEqual({
      capabilities: ["project.read"],
      agentInvocable: true,
    })
  })

  it("is empty for a package with no worker", () => {
    expect(requestedGrant(parse(valid).manifest!)).toEqual({
      capabilities: [],
      agentInvocable: false,
    })
  })
})
