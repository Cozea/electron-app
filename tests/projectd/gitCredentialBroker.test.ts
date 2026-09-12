import { expect, it } from "vitest"
import fs from "node:fs/promises"
import { GitProcess } from "../../apps/projectd/src/git/GitProcess"
import { withGitRepositoryCredential } from "../../apps/projectd/src/git/GitCredentialBroker"

it("serves credentials only to the exact repository without secrets in helper configuration", async () => {
  const git = new GitProcess()
  let socket = ""
  await withGitRepositoryCredential("https://github.com/team/app.git", "fixture-secret", async (env) => {
    socket = env.COZEA_GIT_CREDENTIAL_SOCKET!
    expect(JSON.stringify(env)).not.toContain("fixture-secret")
    const fill = (fields: string) => git.execute(["credential", "fill"], { cwd: process.cwd(), env,
      stdin: fields + "\n\n", allowNonZeroExit: true })
    expect((await fill("protocol=https\nhost=github.com\npath=team/app.git")).stdout).toContain("password=fixture-secret")
    for (const fields of ["protocol=https\nhost=github.com\npath=team/other.git", "protocol=https\nhost=github.com.evil.test\npath=team/app.git", "protocol=https\nhost=github.com"]) {
      const denied = await fill(fields)
      expect(denied.success).toBe(false)
      expect(denied.stdout + denied.stderr).not.toContain("fixture-secret")
    }
    expect((await fs.stat(socket)).mode & 0o777).toBe(0o600)
  })
  await expect(fs.stat(socket)).rejects.toMatchObject({ code: "ENOENT" })
  await expect(withGitRepositoryCredential("https://github.com/team/app.git", "fixture-secret", async (env) => {
    socket = env.COZEA_GIT_CREDENTIAL_SOCKET!
    throw new Error("Git operation failed")
  })).rejects.toThrow("Git operation failed")
  await expect(fs.stat(socket)).rejects.toMatchObject({ code: "ENOENT" })
})
