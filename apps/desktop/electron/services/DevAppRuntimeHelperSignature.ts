import { spawnSync } from "node:child_process"

const CODESIGN_PATH = "/usr/bin/codesign"
const CODESIGN_TIMEOUT_MS = 20_000
const TEAM_IDENTIFIER_LINE = /^TeamIdentifier=(.+)$/m
const TEAM_IDENTIFIER = /^[A-Z0-9]{6,12}$/

export interface CodesignResult {
  status: number | null
  output: string
}

export type CodesignRunner = (args: string[]) => CodesignResult

export interface DevAppHelperSignatureVerifier {
  /**
   * Throws unless the container helper is validly signed by the same Apple team as the
   * running application. Success is spawn authority; the resource-manifest hash check is
   * tamper evidence only, because that manifest sits beside the binary it describes.
   */
  verify(helperPath: string): void
}

export function runCodesign(args: string[]): CodesignResult {
  const result = spawnSync(CODESIGN_PATH, args, {
    encoding: "utf8",
    timeout: CODESIGN_TIMEOUT_MS,
    env: { PATH: "/usr/bin:/bin" },
  })
  if (result.error) {
    throw new Error("The DevApp container runtime helper signature could not be inspected.")
  }
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

/** Reads a signed target's Apple team, or null when the target carries no team identity. */
export function readTeamIdentifier(run: CodesignRunner, targetPath: string): string | null {
  const result = run(["-d", "--verbose=4", "--", targetPath])
  if (result.status !== 0) return null
  const match = TEAM_IDENTIFIER_LINE.exec(result.output)
  const value = match?.[1]?.trim()
  return value && TEAM_IDENTIFIER.test(value) ? value : null
}

/**
 * Verifies the helper against the running application's own signing identity.
 *
 * The policy is derived from the host rather than configured, so it cannot be switched off
 * by an environment variable and needs no build-time team pin. A host with no team identity
 * is an unsigned local build, where no stronger statement is available than the one the
 * resource manifest already makes.
 */
export function createCodesignHelperVerifier(
  hostPath: () => string,
  run: CodesignRunner = runCodesign,
): DevAppHelperSignatureVerifier {
  return {
    verify(helperPath: string): void {
      const team = readTeamIdentifier(run, hostPath())
      if (!team) return
      // `-R` reads a requirement *file*; the inline form must be a single `-R=<text>` argument.
      const requirement = `-R=anchor apple generic and certificate leaf[subject.OU] = "${team}"`
      const verified = run(["--verify", "--strict", requirement, "--", helperPath])
      if (verified.status !== 0) {
        throw new Error(
          "The DevApp container runtime helper is not validly signed by this application's Apple team.",
        )
      }
    },
  }
}

/** Permits any helper. Only for unpackaged development builds and tests. */
export const permissiveHelperSignatureVerifier: DevAppHelperSignatureVerifier = {
  verify(): void {},
}
