/**
 * Machine-readable Git status parser using porcelain v2 with NUL-delimiters.
 *
 * Master Specification: Section 17.5
 * Command: `git status --porcelain=v2 -z --branch --untracked-files=all`
 */

export interface GitFileStatus {
  path: string
  origPath?: string
  stagedStatus: string // 'M', 'A', 'D', 'R', 'C', '.'
  unstagedStatus: string // 'M', 'D', '?', '.'
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isConflicted: boolean
  isIgnored: boolean
  modeHead?: string
  modeIndex?: string
  modeWorktree?: string
  headOid?: string
  indexOid?: string
}

export interface ParsedGitStatus {
  headOid: string | null
  headRef: string | null
  isDetached: boolean
  isUnborn: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  clean: boolean
}

export class GitStatusParser {
  static parsePorcelainV2(outputBuffer: Buffer | string): ParsedGitStatus {
    const raw = typeof outputBuffer === "string" ? outputBuffer : outputBuffer.toString("utf8")
    const tokens = raw.split("\0")

    let headOid: string | null = null
    let headRef: string | null = null
    let isDetached = false
    let isUnborn = false
    let upstream: string | null = null
    let ahead = 0
    let behind = 0
    const files: GitFileStatus[] = []

    let i = 0
    while (i < tokens.length) {
      const token = tokens[i]
      i += 1
      if (!token) continue

      // Branch header lines (start with '# ')
      if (token.startsWith("# ")) {
        const parts = token.slice(2).split(" ")
        const key = parts[0]
        const val = parts.slice(1).join(" ")

        switch (key) {
          case "branch.oid":
            if (val === "(initial)") {
              isUnborn = true
              headOid = null
            } else {
              headOid = val
            }
            break
          case "branch.head":
            if (val === "(detached)") {
              isDetached = true
              headRef = null
            } else {
              headRef = val
            }
            break
          case "branch.upstream":
            upstream = val
            break
          case "branch.ab": {
            const abMatch = val.match(/\+(\d+)\s+-(\d+)/)
            if (abMatch) {
              ahead = Number(abMatch[1])
              behind = Number(abMatch[2])
            }
            break
          }
        }
        continue
      }

      // Changed tracked entry: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      if (token.startsWith("1 ")) {
        const parts = token.split(" ")
        if (parts.length >= 9) {
          const xy = parts[1]
          const mH = parts[3]
          const mI = parts[4]
          const mW = parts[5]
          const hH = parts[6]
          const hI = parts[7]
          const filePath = parts.slice(8).join(" ")

          const stagedStatus = xy[0]
          const unstagedStatus = xy[1]

          files.push({
            path: filePath,
            stagedStatus,
            unstagedStatus,
            isStaged: stagedStatus !== ".",
            isUnstaged: unstagedStatus !== ".",
            isUntracked: false,
            isConflicted: false,
            isIgnored: false,
            modeHead: mH,
            modeIndex: mI,
            modeWorktree: mW,
            headOid: hH,
            indexOid: hI,
          })
        }
        continue
      }

      // Renamed / Copied entry: "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>"
      if (token.startsWith("2 ")) {
        const parts = token.split(" ")
        if (parts.length >= 10) {
          const xy = parts[1]
          const mH = parts[3]
          const mI = parts[4]
          const mW = parts[5]
          const hH = parts[6]
          const hI = parts[7]
          const filePath = parts.slice(9).join(" ")
          // In -z mode, the next token is the original path
          const origPath = i < tokens.length ? tokens[i] : undefined
          i += 1

          const stagedStatus = xy[0]
          const unstagedStatus = xy[1]

          files.push({
            path: filePath,
            origPath,
            stagedStatus,
            unstagedStatus,
            isStaged: stagedStatus !== ".",
            isUnstaged: unstagedStatus !== ".",
            isUntracked: false,
            isConflicted: false,
            isIgnored: false,
            modeHead: mH,
            modeIndex: mI,
            modeWorktree: mW,
            headOid: hH,
            indexOid: hI,
          })
        }
        continue
      }

      // Unmerged (conflict) entry: "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      if (token.startsWith("u ")) {
        const parts = token.split(" ")
        if (parts.length >= 11) {
          const xy = parts[1]
          const filePath = parts.slice(10).join(" ")

          files.push({
            path: filePath,
            stagedStatus: xy[0],
            unstagedStatus: xy[1],
            isStaged: true,
            isUnstaged: true,
            isUntracked: false,
            isConflicted: true,
            isIgnored: false,
          })
        }
        continue
      }

      // Untracked entry: "? <path>"
      if (token.startsWith("? ")) {
        const filePath = token.slice(2)
        files.push({
          path: filePath,
          stagedStatus: ".",
          unstagedStatus: "?",
          isStaged: false,
          isUnstaged: true,
          isUntracked: true,
          isConflicted: false,
          isIgnored: false,
        })
        continue
      }

      // Ignored entry: "! <path>"
      if (token.startsWith("! ")) {
        const filePath = token.slice(2)
        files.push({
          path: filePath,
          stagedStatus: ".",
          unstagedStatus: ".",
          isStaged: false,
          isUnstaged: false,
          isUntracked: false,
          isConflicted: false,
          isIgnored: true,
        })
        continue
      }
    }

    const clean = files.filter((f) => !f.isIgnored).length === 0

    return {
      headOid,
      headRef,
      isDetached,
      isUnborn,
      upstream,
      ahead,
      behind,
      files,
      clean,
    }
  }
}
