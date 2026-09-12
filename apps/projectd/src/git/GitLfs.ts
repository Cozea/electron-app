/**
 * Git LFS pointer validation and local clean support.
 *
 * Master Specification: Section 11.5, 15.6, 17.2
 */

import { createHash } from "node:crypto"
import type { GitProcess } from "./GitProcess"

export const LFS_POINTER_HEADER = "version https://git-lfs.github.com/spec/v1"
const MAX_LFS_POINTER_BYTES = 1024 * 1024

type GitProcessRunner = Pick<GitProcess, "execute">

export interface LfsPointer {
  oid: string // sha256:hex
  size: number
}

export interface GitLfsCleaner {
  isAvailable(cwd: string): Promise<boolean>
  cleanToPointer(cwd: string, filePath: string, contents: Buffer, env?: Record<string, string>): Promise<Buffer>
}

export class GitLfs implements GitLfsCleaner {
  private readonly git?: GitProcessRunner

  constructor(git?: GitProcessRunner) {
    this.git = git
  }

  static isLfsPointer(content: string | Buffer): boolean {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content
    if (bytes.length > MAX_LFS_POINTER_BYTES) return false
    return bytes.toString("utf8").startsWith(LFS_POINTER_HEADER)
  }

  static parsePointer(content: string | Buffer): LfsPointer | null {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content
    if (bytes.length > MAX_LFS_POINTER_BYTES) return null
    const text = bytes.toString("utf8")
    if (!text.startsWith(LFS_POINTER_HEADER)) {
      return null
    }

    const oidMatch = text.match(/oid sha256:([a-f0-9]{64})/)
    const sizeMatch = text.match(/size (\d+)/)

    if (!oidMatch || !sizeMatch) {
      return null
    }

    return {
      oid: `sha256:${oidMatch[1]}`,
      size: Number(sizeMatch[1]),
    }
  }

  static createPointer(sha256Hex: string, size: number): string {
    const cleanHash = sha256Hex.replace(/^sha256:/, "")
    return `${LFS_POINTER_HEADER}\noid sha256:${cleanHash}\nsize ${size}\n`
  }

  async isAvailable(cwd: string): Promise<boolean> {
    if (!this.git) return false
    const result = await this.git.execute(["lfs", "version"], { cwd, allowNonZeroExit: true })
    return result.success
  }

  /**
   * Stores one payload in the local LFS object store and returns the small pointer
   * that belongs in Git. `git lfs clean` is local-only: no fetch/upload occurs here.
   */
  async cleanToPointer(cwd: string, filePath: string, contents: Buffer, env?: Record<string, string>): Promise<Buffer> {
    if (!this.git) throw new Error("Git LFS is not configured")
    const result = await this.git.execute(["lfs", "clean", "--", filePath], {
      cwd,
      env,
      stdin: contents,
      allowNonZeroExit: true,
      maxBuffer: MAX_LFS_POINTER_BYTES,
    })
    if (!result.success) {
      throw new Error(`Git LFS could not clean ${filePath}: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
    }
    const pointer = Buffer.from(result.stdoutBuffer)
    const parsed = GitLfs.parsePointer(pointer)
    const expectedOid = `sha256:${createHash("sha256").update(contents).digest("hex")}`
    if (!parsed || parsed.oid !== expectedOid || parsed.size !== contents.length) {
      throw new Error(`Git LFS returned an invalid pointer for ${filePath}`)
    }
    return pointer
  }
}
