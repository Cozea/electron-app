/**
 * Git LFS pointer validation and generation.
 *
 * Master Specification: Section 11.5, 15.6, 17.2
 */

export const LFS_POINTER_HEADER = "version https://git-lfs.github.com/spec/v1"

export interface LfsPointer {
  oid: string // sha256:hex
  size: number
}

export class GitLfs {
  static isLfsPointer(content: string | Buffer): boolean {
    const text = typeof content === "string" ? content : content.toString("utf8")
    return text.startsWith(LFS_POINTER_HEADER)
  }

  static parsePointer(content: string | Buffer): LfsPointer | null {
    const text = typeof content === "string" ? content : content.toString("utf8")
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
}
