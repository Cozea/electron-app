import type { GitExecuteOptions, GitProcess } from "./GitProcess"
import { withGitRepositoryCredential } from "./GitCredentialBroker"

export type RepositoryCredentialProvider = (scope: { owner: string; repository: string }) => Promise<string>

/** Resolve the effective URL on every operation, including a distinct pushurl.
 * Repository config remains untouched; Cozea-owned GitHub SSH uses HTTPS here. */
export async function executeScopedNetworkGit(process: GitProcess, args: string[], remote: string,
  options: GitExecuteOptions, credentials: RepositoryCredentialProvider) {
  if (!["fetch", "push", "ls-remote"].includes(args[0] ?? "")) throw new Error("Unsupported scoped Git command")
  const remoteIndex = args.indexOf(remote, 1)
  if (remoteIndex < 0) throw new Error("Network Git requires an explicit remote")
  const urls = await process.execute(["remote", "get-url", ...(args[0] === "push" ? ["--push"] : []), "--all", remote], { cwd: options.cwd })
  const values = urls.stdout.trim().split("\n").filter(Boolean)
  if (!urls.success || values.length !== 1) throw new Error("Scoped Git requires one unambiguous remote URL")
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(values[0]!)
  if (!match) throw new Error("Background Git requires an authorized GitHub repository")
  const scope = { owner: match[1]!, repository: match[2]! }
  if (args[0] === "push") {
    const fetched = await process.execute(["remote", "get-url", "--all", remote], { cwd: options.cwd })
    const fetchMatch = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(fetched.stdout.trim())
    if (!fetched.success || !fetchMatch || fetchMatch[1]!.toLowerCase() !== scope.owner.toLowerCase() ||
      fetchMatch[2]!.toLowerCase() !== scope.repository.toLowerCase()) throw new Error("Fetch and push must address the same repository for checkpoint reconciliation")
  }
  const url = `https://github.com/${scope.owner}/${scope.repository}.git`
  const token = await credentials(scope)
  // A second URL rewrite could redirect the explicit HTTPS argument after scope
  // validation, potentially falling back to SSH credentials for another repo.
  const rewrites = await process.execute(["config", "--null", "--get-regexp", "^url\\..*\\.(insteadof|pushinsteadof)$"],
    { cwd: options.cwd, allowNonZeroExit: true })
  if (rewrites.exitCode !== 0 && rewrites.exitCode !== 1) throw new Error("Cannot verify Git URL rewrite configuration")
  for (const item of rewrites.stdout.split("\0").filter(Boolean)) {
    const separator = item.indexOf("\n")
    if (separator < 0 || url.startsWith(item.slice(separator + 1))) throw new Error("Git URL rewriting conflicts with scoped authorization")
  }
  const command = [...args]
  command[remoteIndex] = url
  const redact = (text: string) => text.replaceAll(token, "[redacted]")
    .replaceAll(Buffer.from(`x-access-token:${token}`).toString("base64"), "[redacted]")
  try {
    const result = await withGitRepositoryCredential(url, token, (env) => process.execute(command, { ...options, env: { ...options.env, ...env } }))
    return { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr),
      stdoutBuffer: Buffer.from(redact(result.stdoutBuffer.toString("utf8"))), stderrBuffer: Buffer.from(redact(result.stderrBuffer.toString("utf8"))) }
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : "Scoped Git operation failed"))
  }
}
