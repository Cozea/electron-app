import { afterAll, beforeAll } from "vitest"

const GIT_IDENTITY_ENV = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const

/** Gives Git-writing fixtures a process-local identity without mutating Git config. */
export function useTestGitIdentity(): void {
  const previous = new Map<string, string | undefined>()
  beforeAll(() => {
    for (const name of GIT_IDENTITY_ENV) {
      previous.set(name, process.env[name])
      process.env[name] = name.endsWith("EMAIL") ? "tests@cozea.invalid" : "Cozea Tests"
    }
  })
  afterAll(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}
