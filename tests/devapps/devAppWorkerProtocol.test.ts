import { describe, expect, it } from "vitest"

import { ALL_DEV_APP_CAPABILITIES, normalizeGrant } from "../../shared/devAppCapabilities"
import {
  DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION,
  DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
  DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS,
  DEV_APP_WORKER_PROTOCOL_VERSION,
  DEV_APP_METHOD_CAPABILITIES,
  authorizeWorkerMethod,
  capabilityForMethod,
  parseWorkerMessage,
  reachableCapabilities,
  supportsDevAppWorkerProtocolVersion,
} from "../../shared/devAppWorkerProtocol"

const grantOf = (...capabilities: string[]) => normalizeGrant({ capabilities })

describe("Worker authorization — fails closed", () => {
  it("refuses a method absent from the capability table", () => {
    const result = authorizeWorkerMethod("project.deleteEverything", grantOf("project.write"))
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.error.code).toBe("unknown-method")
  })

  it("refuses a known method the grant does not name", () => {
    const result = authorizeWorkerMethod("project.writeFile", grantOf("project.read"))
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error("expected denial")
    expect(result.error.code).toBe("capability-denied")
    // Named so an author can see what to declare rather than guessing.
    expect(result.error.requiredCapability).toBe("project.write")
  })

  it("refuses everything under an empty grant", () => {
    for (const method of Object.keys(DEV_APP_METHOD_CAPABILITIES)) {
      expect(authorizeWorkerMethod(method, grantOf()).allowed, `${method} allowed`).toBe(false)
    }
  })

  it("allows exactly the methods a grant names", () => {
    const grant = grantOf("project.read")
    expect(authorizeWorkerMethod("project.readFile", grant).allowed).toBe(true)
    expect(authorizeWorkerMethod("project.listFiles", grant).allowed).toBe(true)
    expect(authorizeWorkerMethod("project.writeFile", grant).allowed).toBe(false)
    expect(authorizeWorkerMethod("fs.readFile", grant).allowed).toBe(false)
  })

  it("refuses non-string and prototype-borrowed method names", () => {
    // hasOwnProperty guards this: "toString" and "constructor" exist on the prototype
    // chain of a plain object and must not resolve to a capability.
    for (const method of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(capabilityForMethod(method), `${method} resolved`).toBeNull()
    }
    expect(capabilityForMethod(42 as unknown as string)).toBeNull()
  })
})

describe("Worker authorization — escalation does not widen the gate", () => {
  // terminal.spawn confers everything in consequence, which is why approval copy must
  // say so. It must not follow that the gate lets a terminal.spawn holder call fs.readFile
  // directly — the honest description of a grant and the enforcement of it are separate.
  it("does not let an escalating capability satisfy another capability", () => {
    const grant = grantOf("terminal.spawn")
    expect(authorizeWorkerMethod("terminal.create", grant).allowed).toBe(true)
    expect(authorizeWorkerMethod("fs.readFile", grant).allowed).toBe(false)
    expect(authorizeWorkerMethod("project.writeFile", grant).allowed).toBe(false)
  })

  it("keeps project scope separate from machine scope", () => {
    const scoped = grantOf("project.read")
    expect(authorizeWorkerMethod("project.readFile", scoped).allowed).toBe(true)
    // The distinction that matters most: reaching the whole disk is a different grant.
    expect(authorizeWorkerMethod("fs.readFile", scoped).allowed).toBe(false)

    const machine = grantOf("fs.read")
    expect(authorizeWorkerMethod("fs.readFile", machine).allowed).toBe(true)
    expect(authorizeWorkerMethod("project.readFile", machine).allowed).toBe(false)
  })
})

describe("Worker capability table — coverage", () => {
  it("maps every method to a capability in the vocabulary", () => {
    for (const [method, capability] of Object.entries(DEV_APP_METHOD_CAPABILITIES)) {
      expect(ALL_DEV_APP_CAPABILITIES, `${method} maps outside the vocabulary`).toContain(
        capability,
      )
    }
  })

  it("reports a declared capability no method requires as unreachable", () => {
    // Not an error — it may be forward-declared — but it must not be presented as
    // granting something today.
    const grant = normalizeGrant({ capabilities: ["project.read", "project.metadata"] })
    expect(reachableCapabilities(grant)).toContain("project.read")
  })
})

describe("Worker message parsing — untrusted input", () => {
  it("publishes one explicit supported protocol range", () => {
    expect(DEV_APP_WORKER_PROTOCOL_MIN_VERSION).toBe(1)
    expect(DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION).toBe(1)
    expect(DEV_APP_WORKER_PROTOCOL_VERSION).toBe(1)
    expect(DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS).toEqual([1])
    expect(supportsDevAppWorkerProtocolVersion(1)).toBe(true)
    expect(supportsDevAppWorkerProtocolVersion(0)).toBe(false)
    expect(supportsDevAppWorkerProtocolVersion(2)).toBe(false)
    expect(supportsDevAppWorkerProtocolVersion(1.5)).toBe(false)
  })

  it("parses a well-formed request", () => {
    expect(
      parseWorkerMessage({
        kind: "request",
        id: "1",
        method: "project.readFile",
        params: { path: "a" },
      }),
    ).toEqual({
      kind: "request",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      id: "1",
      method: "project.readFile",
      params: { path: "a" },
    })
  })

  it("parses a response carrying a result", () => {
    expect(parseWorkerMessage({ kind: "response", id: "1", result: 7 })).toEqual({
      kind: "response",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      id: "1",
      result: 7,
    })
  })

  it("accepts an omitted version only as the legacy v1 alias", () => {
    expect(parseWorkerMessage({ kind: "event", topic: "ready" }, 1)).toMatchObject({
      protocolVersion: DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION,
    })
    expect(parseWorkerMessage({ kind: "event", topic: "ready" }, 2)).toBeNull()
  })

  it("refuses an explicit protocol mismatch", () => {
    expect(
      parseWorkerMessage({
        kind: "request",
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION + 1,
        id: "1",
        method: "project.readFile",
      }),
    ).toBeNull()
  })

  it("refuses a response carrying both a result and an error", () => {
    expect(
      parseWorkerMessage({
        kind: "response",
        id: "1",
        result: 1,
        error: { code: "x", message: "y" },
      }),
    ).toBeNull()
  })

  it("refuses a response carrying neither", () => {
    expect(parseWorkerMessage({ kind: "response", id: "1" })).toBeNull()
  })

  it("refuses malformed envelopes", () => {
    const rejected: unknown[] = [
      null,
      undefined,
      "request",
      42,
      [],
      {},
      { kind: "nope" },
      { kind: "request" },
      { kind: "request", id: "", method: "project.readFile" },
      { kind: "request", id: "1" },
      { kind: "request", id: "1", method: "" },
      { kind: "request", id: 1, method: "project.readFile" },
      { kind: "event" },
      { kind: "event", topic: "" },
    ]
    for (const value of rejected) {
      expect(parseWorkerMessage(value), `${JSON.stringify(value)} parsed`).toBeNull()
    }
  })

  it("refuses over-long identifiers and method names", () => {
    expect(
      parseWorkerMessage({ kind: "request", id: "x".repeat(200), method: "project.readFile" }),
    ).toBeNull()
    expect(parseWorkerMessage({ kind: "request", id: "1", method: "m".repeat(200) })).toBeNull()
  })

  it("does not vouch for a parsed method, only its shape", () => {
    // Parsing and authorization are separate: a syntactically valid request naming an
    // unknown method must survive parsing and then be denied.
    const message = parseWorkerMessage({
      kind: "request",
      id: "1",
      method: "definitely.not.a.method",
    })
    expect(message).not.toBeNull()
    expect(authorizeWorkerMethod("definitely.not.a.method", grantOf("fs.read")).allowed).toBe(false)
  })
})
