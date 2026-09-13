/**
 * Commit identity for commits Cozea makes for a person: theirs, from Git's own config,
 * or Cozea's through the environment when Git has none. Nothing is written to their
 * config.
 */

import type { GitProcess } from "./GitProcess"

export async function fallbackIdentityEnv(
  git: GitProcess,
  cwd: string,
  fallback: { name: string; email: string },
): Promise<Record<string, string>> {
  const [name, email] = await Promise.all([
    git.execute(["config", "--get", "user.name"], { cwd, allowNonZeroExit: true }),
    git.execute(["config", "--get", "user.email"], { cwd, allowNonZeroExit: true }),
  ])
  const env: Record<string, string> = {}
  if (!name.stdout.trim()) {
    env.GIT_AUTHOR_NAME = fallback.name
    env.GIT_COMMITTER_NAME = fallback.name
  }
  if (!email.stdout.trim()) {
    env.GIT_AUTHOR_EMAIL = fallback.email
    env.GIT_COMMITTER_EMAIL = fallback.email
  }
  return env
}
