import fs from "node:fs/promises"
import path from "node:path"
import type { LocalWorkspaceDTO } from "../../../../shared/workspaceTypes"
import type { CollaborationRepositoryBindingDescriptor, CollaborationRepositoryCredentialResponse } from "../../../../shared/collaborationRepository"
import type { RepositoryDownloadProgress } from "../../../../shared/collaborationDesktop"
import type { CollaborationGitResult } from "./SessionWorkspaceCoordinator"

interface DownloadDependencies {
  binding(projectId: string): Promise<CollaborationRepositoryBindingDescriptor | null>
  credential(projectId: string): Promise<CollaborationRepositoryCredentialResponse>
  allocate(projectId: string, slug: string, prepare: (directory: string) => Promise<void>): Promise<LocalWorkspaceDTO>
  git(args: string[], options: { cwd: string; env?: Record<string, string>; signal: AbortSignal }): Promise<CollaborationGitResult>
  activate(workspace: LocalWorkspaceDTO): Promise<void>
  progress(event: RepositoryDownloadProgress): void
}

/** Credentials remain in main memory; only catalog-owned, unpublished directories are prepared. */
export class AuthorizedRepositoryDownloader {
  private readonly deps: DownloadDependencies
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<LocalWorkspaceDTO> }>()
  constructor(deps: DownloadDependencies) { this.deps = deps }

  cancel(projectId: string): void { this.active.get(projectId)?.controller.abort() }
  download(projectId: string, slug: string): Promise<LocalWorkspaceDTO> {
    const active = this.active.get(projectId)
    if (active) return active.promise
    const controller = new AbortController()
    const promise = this.run(projectId, slug, controller.signal).finally(() => this.active.delete(projectId))
    this.active.set(projectId, { controller, promise })
    return promise
  }

  private async run(projectId: string, slug: string, signal: AbortSignal): Promise<LocalWorkspaceDTO> {
    const stage = (phase: RepositoryDownloadProgress["phase"]) => this.deps.progress({ projectId, phase })
    const check = () => { if (signal.aborted) throw new Error("Repository download cancelled; retry to resume") }
    try {
      stage("authorizing")
      const binding = await this.deps.binding(projectId)
      if (!binding?.enabled) throw new Error("This project does not have an enabled organization repository binding")
      const credential = await this.deps.credential(projectId)
      check()
      if (credential.expiresAt <= Date.now() || credential.operation !== "read" || !credential.token ||
        ["repositoryId", "repositoryNumericId", "defaultBranch", "fullName", "cloneUrl"].some(field => credential[field as keyof typeof credential] !== binding[field as keyof typeof binding])) throw new Error("Repository binding changed; retry the download")
      if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(credential.cloneUrl)) throw new Error("Expected an authorized GitHub repository URL")
      const env = {
        GIT_CONFIG_COUNT: "5", GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${credential.token}`).toString("base64")}`,
        GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "",
        GIT_CONFIG_KEY_2: "http.followRedirects", GIT_CONFIG_VALUE_2: "false",
        GIT_CONFIG_KEY_3: "protocol.allow", GIT_CONFIG_VALUE_3: "never",
        GIT_CONFIG_KEY_4: "protocol.https.allow", GIT_CONFIG_VALUE_4: "always",
        GIT_TRACE: "0", GIT_TRACE_PACKET: "0", GIT_TRACE_CURL: "0", GIT_CURL_VERBOSE: "0",
        GIT_TRACE2: "0", GIT_TRACE2_EVENT: "0", GIT_TRACE2_PERF: "0", GIT_TERMINAL_PROMPT: "0",
      }
      const workspace = await this.deps.allocate(projectId, slug, async directory => {
        const git = async (args: string[], remote = false) => {
          check()
          const result = await this.deps.git(["-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, signal, ...(remote ? { env } : {}) })
          check()
          // checkout-index without --force skips existing files with status 1;
          // its result is verified against the index below before activation.
          if (!result.success && args[0] !== "checkout-index") throw new Error(remote ? "GitHub download failed. Check repository access and retry." : "Repository preparation failed; local recovery was retained")
          return result.stdout.replace(/\n$/, "")
        }
        // A previous interrupted catalog reservation can be resumed only if no
        // working file was materialized. Dirty or foreign data is never reset.
        const entries = await fs.readdir(directory)
        const receiptPath = path.join(directory, ".git", "cozea-download.json")
        let receipt: { cloneUrl: string; sha: string; branch: string } | null = null
        if (entries.includes(".git")) {
          const stat = await fs.lstat(path.join(directory, ".git"))
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Retained download Git directory is not owned by this download")
          if (await git(["remote", "get-url", "origin"]) !== credential.cloneUrl) throw new Error("Retained download belongs to a different repository")
          receipt = await fs.readFile(receiptPath, "utf8").then(value => JSON.parse(value) as typeof receipt).catch(error => { if (error.code === "ENOENT") return null; throw error })
        } else {
          if (entries.length) throw new Error("The retained download contains unrelated files; they have been retained")
          await git(["init"])
          await git(["remote", "add", "origin", credential.cloneUrl])
        }
        if (receipt) {
          if (receipt.cloneUrl !== credential.cloneUrl || !/^[a-f0-9]{40}$/.test(receipt.sha) || receipt.branch !== credential.defaultBranch) throw new Error("Download recovery identity changed; local files were retained")
          if (await git(["symbolic-ref", "HEAD"]) !== `refs/heads/${receipt.branch}` ||
            await git(["rev-parse", "--verify", "HEAD"]) !== receipt.sha ||
            await git(["write-tree"]) !== await git(["rev-parse", `${receipt.sha}^{tree}`])) {
            throw new Error("Retained download Git state changed; local files were retained")
          }
          // Interrupted checkout: only missing indexed files may be filled. Any
          // modified or untracked bytes pause recovery without overwriting them.
          const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
          if (status.split("\0").filter(Boolean).some(row => !row.startsWith(" D "))) throw new Error("Retained download has local changes; attach the retained folder to recover them")
          stage("materializing")
          await git(["checkout-index", "--all"])
          if (await git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Download recovery is incomplete; local files were retained")
          return
        }
        if (entries.some(name => name !== ".git")) throw new Error("The retained download contains local files; they have been retained")
        await git(["check-ref-format", "--branch", credential.defaultBranch])
        stage("fetching")
        await git(["fetch", "--no-tags", "--no-recurse-submodules", "--", credential.cloneUrl, `refs/heads/${credential.defaultBranch}:refs/remotes/origin/${credential.defaultBranch}`], true)
        const sha = await git(["rev-parse", "--verify", `refs/remotes/origin/${credential.defaultBranch}^{commit}`])
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub returned an invalid commit")
        await git(["symbolic-ref", "HEAD", `refs/heads/${credential.defaultBranch}`])
        await git(["update-ref", `refs/heads/${credential.defaultBranch}`, sha])
        await git(["read-tree", sha])
        const receiptFile = await fs.open(receiptPath, "wx", 0o600)
        try { await receiptFile.writeFile(JSON.stringify({ cloneUrl: credential.cloneUrl, sha, branch: credential.defaultBranch })); await receiptFile.sync() } finally { await receiptFile.close() }
        const gitDirectory = await fs.open(path.dirname(receiptPath), "r")
        try { await gitDirectory.sync() } finally { await gitDirectory.close() }
        stage("materializing")
        await git(["checkout-index", "--all"])
        if (await git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Repository files are incomplete; retry the retained download")
      })
      check()
      await this.deps.activate(workspace)
      stage("complete")
      return workspace
    } catch (error) { stage(signal.aborted ? "cancelled" : "failed"); throw error }
  }
}
