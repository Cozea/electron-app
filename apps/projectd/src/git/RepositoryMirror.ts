import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { GitProcess } from "./GitProcess"

export function getDefaultGitMirrorsDir(): string {
  if (process.env.COZEA_GIT_MIRRORS_DIR) {
    return process.env.COZEA_GIT_MIRRORS_DIR
  }
  return path.join(os.homedir(), "Library/Application Support/Cozea/git-mirrors")
}

export class RepositoryMirrorManager {
  readonly mirrorsDir: string
  readonly process: GitProcess

  constructor(process: GitProcess, mirrorsDir?: string) {
    this.process = process
    this.mirrorsDir = mirrorsDir ?? getDefaultGitMirrorsDir()
  }

  getMirrorPath(repositoryBindingId: string): string {
    const safeName = repositoryBindingId.replace(/[^a-zA-Z0-9._-]/g, "_")
    return path.join(this.mirrorsDir, `${safeName}.git`)
  }

  async ensureMirror(repositoryBindingId: string, remoteUrl?: string): Promise<string> {
    const mirrorPath = this.getMirrorPath(repositoryBindingId)
    if (!fs.existsSync(this.mirrorsDir)) {
      fs.mkdirSync(this.mirrorsDir, { recursive: true })
    }

    if (!fs.existsSync(mirrorPath)) {
      if (remoteUrl) {
        // Clone bare mirror
        const cloneRes = await this.process.execute(
          ["clone", "--bare", remoteUrl, mirrorPath],
          { cwd: this.mirrorsDir },
        )
        if (!cloneRes.success) {
          throw new Error(`Failed to clone bare mirror from ${remoteUrl}: ${cloneRes.stderr}`)
        }
      } else {
        // Initialize bare repo
        const initRes = await this.process.execute(["init", "--bare", mirrorPath], {
          cwd: this.mirrorsDir,
        })
        if (!initRes.success) {
          throw new Error(`Failed to initialize bare mirror at ${mirrorPath}: ${initRes.stderr}`)
        }
      }
    }

    return mirrorPath
  }

  async fetch(repositoryBindingId: string, remoteUrl?: string): Promise<void> {
    const mirrorPath = await this.ensureMirror(repositoryBindingId, remoteUrl)

    if (remoteUrl) {
      // Set or update remote origin
      await this.process.execute(
        ["remote", "set-url", "origin", remoteUrl],
        { cwd: mirrorPath, allowNonZeroExit: true },
      )
    }

    const fetchRes = await this.process.execute(
      ["fetch", "--prune", "origin", "+refs/heads/*:refs/heads/*"],
      { cwd: mirrorPath, allowNonZeroExit: true },
    )
    if (!fetchRes.success) {
      console.warn(`[RepositoryMirror] Fetch failed for ${repositoryBindingId}:`, fetchRes.stderr)
    }
  }

  async getCommitOid(repositoryBindingId: string, ref: string): Promise<string | null> {
    const mirrorPath = this.getMirrorPath(repositoryBindingId)
    if (!fs.existsSync(mirrorPath)) return null

    const res = await this.process.execute(["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: mirrorPath,
      allowNonZeroExit: true,
    })
    return res.success ? res.stdout.trim() : null
  }

  async getMergeBase(
    repositoryBindingId: string,
    refA: string,
    refB: string,
  ): Promise<string | null> {
    const mirrorPath = this.getMirrorPath(repositoryBindingId)
    if (!fs.existsSync(mirrorPath)) return null

    const res = await this.process.execute(["merge-base", refA, refB], {
      cwd: mirrorPath,
      allowNonZeroExit: true,
    })
    return res.success ? res.stdout.trim() : null
  }

  async getBehindAhead(
    repositoryBindingId: string,
    baseRef: string,
    headRef: string,
  ): Promise<{ behind: number; ahead: number }> {
    const mirrorPath = this.getMirrorPath(repositoryBindingId)
    if (!fs.existsSync(mirrorPath)) return { behind: 0, ahead: 0 }

    const res = await this.process.execute(
      ["rev-list", "--count", "--left-right", `${baseRef}...${headRef}`],
      { cwd: mirrorPath, allowNonZeroExit: true },
    )

    if (!res.success) {
      return { behind: 0, ahead: 0 }
    }

    // Output: "<behind>\t<ahead>\n"
    const match = res.stdout.trim().match(/^(\d+)\s+(\d+)$/)
    if (match) {
      return {
        behind: Number(match[1]),
        ahead: Number(match[2]),
      }
    }

    return { behind: 0, ahead: 0 }
  }
}
