import { describe, expect, it, vi } from "vitest"

import {
  createCodesignHelperVerifier,
  readTeamIdentifier,
  runCodesign,
  type CodesignResult,
} from "../../apps/desktop/electron/services/DevAppRuntimeHelperSignature"

const HOST = "/Applications/Cozea.app/Contents/MacOS/Cozea"
const HELPER = "/Applications/Cozea.app/Contents/Resources/devapp-container-runtime/cozea-devapp-container-runtime"

const SIGNED_HOST = `Executable=${HOST}
Identifier=app.cozea.desktop
Format=app bundle with Mach-O universal
TeamIdentifier=AB12CD34EF
Sealed Resources version=2 rules=13 files=204
`

function runner(handler: (args: string[]) => CodesignResult) {
  return vi.fn(handler)
}

describe("readTeamIdentifier", () => {
  it("reads the team from a signed target", () => {
    const run = runner(() => ({ status: 0, output: SIGNED_HOST }))
    expect(readTeamIdentifier(run, HOST)).toBe("AB12CD34EF")
    expect(run).toHaveBeenCalledWith(["-d", "--verbose=4", "--", HOST])
  })

  it("reports no team when the target carries no signature", () => {
    const run = runner(() => ({ status: 1, output: "code object is not signed at all\n" }))
    expect(readTeamIdentifier(run, HOST)).toBeNull()
  })

  it("reports no team for an ad-hoc signature", () => {
    const run = runner(() => ({ status: 0, output: "Identifier=x\nTeamIdentifier=not set\n" }))
    expect(readTeamIdentifier(run, HOST)).toBeNull()
  })

  it("rejects a team identifier that is not a plausible Apple team", () => {
    const run = runner(() => ({ status: 0, output: 'TeamIdentifier=" or 1=1 --\n' }))
    expect(readTeamIdentifier(run, HOST)).toBeNull()
  })
})

describe("createCodesignHelperVerifier", () => {
  it("requires the helper to satisfy a requirement pinned to the host's team", () => {
    const run = runner((args) => {
      if (args[0] === "-d") return { status: 0, output: SIGNED_HOST }
      return { status: 0, output: `${HELPER}: valid on disk\n` }
    })
    createCodesignHelperVerifier(() => HOST, run).verify(HELPER)
    expect(run).toHaveBeenLastCalledWith([
      "--verify",
      "--strict",
      '-R=anchor apple generic and certificate leaf[subject.OU] = "AB12CD34EF"',
      "--",
      HELPER,
    ])
  })

  it("refuses a helper that fails the host's designated requirement", () => {
    const run = runner((args) => {
      if (args[0] === "-d") return { status: 0, output: SIGNED_HOST }
      return { status: 1, output: "test-requirement: code failed to satisfy specified code requirement(s)\n" }
    })
    expect(() => createCodesignHelperVerifier(() => HOST, run).verify(HELPER)).toThrow(
      "not validly signed by this application's Apple team",
    )
  })

  it("refuses a helper validly signed by a different Apple team", () => {
    // The substantive property: a real Developer ID signature is not by itself authority.
    const run = runner((args) => {
      if (args[0] === "-d") return { status: 0, output: SIGNED_HOST }
      const requirement = args[2] ?? ""
      return requirement.includes("AB12CD34EF")
        ? { status: 1, output: "code failed to satisfy specified code requirement(s)\n" }
        : { status: 0, output: "valid on disk\n" }
    })
    expect(() => createCodesignHelperVerifier(() => HOST, run).verify(HELPER)).toThrow(
      "not validly signed by this application's Apple team",
    )
  })

  it("refuses an unsigned helper", () => {
    const run = runner((args) => {
      if (args[0] === "-d") return { status: 0, output: SIGNED_HOST }
      return { status: 1, output: "code object is not signed at all\n" }
    })
    expect(() => createCodesignHelperVerifier(() => HOST, run).verify(HELPER)).toThrow(
      "not validly signed by this application's Apple team",
    )
  })

  it("permits the helper when the host itself carries no team identity", () => {
    // An unsigned local build cannot make a stronger statement than the resource manifest
    // already makes, and must not be bricked by asking it to.
    const run = runner(() => ({ status: 1, output: "code object is not signed at all\n" }))
    expect(() => createCodesignHelperVerifier(() => HOST, run).verify(HELPER)).not.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

const onDarwin = process.platform === "darwin" ? describe : describe.skip

onDarwin("the real codesign invocation", () => {
  // `-R` names a requirement *file*. Passing the requirement as its own argument makes every
  // verification fail with "invalid requirement specification", which no fake runner can catch:
  // the gate would reject every helper in every signed build. Assert the real argument form.
  it("passes the requirement inline rather than as a path", () => {
    const result = runCodesign(["--verify", "--strict", "-R=anchor apple", "--", "/bin/ls"])
    expect(result.output).not.toContain("invalid requirement specification")
    expect(result.status).toBe(0)
  })

  it("reports a requirement failure, not a syntax error, for a team that does not match", () => {
    const result = runCodesign([
      "--verify",
      "--strict",
      '-R=anchor apple generic and certificate leaf[subject.OU] = "ZZ99ZZ99ZZ"',
      "--",
      "/bin/ls",
    ])
    expect(result.output).not.toContain("invalid requirement specification")
    expect(result.status).not.toBe(0)
  })
})
