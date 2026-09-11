/**
 * Git attributes helper for inspectable path classification.
 *
 * Master Specification: Section 10.9, 17.3
 * Command: `git check-attr -z --all --stdin`
 */

import type { GitProcess } from "./GitProcess"

export interface PathAttributes {
  readonly path: string
  readonly attributes: Record<string, string>
  readonly isBinary: boolean
  readonly isLfs: boolean
  readonly lineEnding?: "lf" | "crlf" | "auto"
}

export class GitAttributes {
  readonly process: GitProcess

  constructor(process: GitProcess) {
    this.process = process
  }

  async checkAttributes(cwd: string, filePaths: string[]): Promise<Map<string, PathAttributes>> {
    const results = new Map<string, PathAttributes>()
    if (filePaths.length === 0) {
      return results
    }

    // In -z mode, stdin paths must be NUL-delimited
    const stdin = filePaths.join("\0") + "\0"
    const res = await this.process.execute(["check-attr", "-z", "--all", "--stdin"], {
      cwd,
      stdin,
      allowNonZeroExit: true,
    })

    if (!res.success) {
      // Fallback: empty attributes
      for (const p of filePaths) {
        results.set(p, {
          path: p,
          attributes: {},
          isBinary: false,
          isLfs: false,
        })
      }
      return results
    }

    // Output format in -z mode: <path>\0<attribute>\0<info>\0
    const tokens = res.stdout.split("\0")
    let i = 0
    while (i + 2 < tokens.length) {
      const p = tokens[i]
      const attr = tokens[i + 1]
      const info = tokens[i + 2]
      i += 3

      if (!p || !attr) continue

      let existing = results.get(p)
      if (!existing) {
        existing = {
          path: p,
          attributes: {},
          isBinary: false,
          isLfs: false,
        }
        results.set(p, existing)
      }

      existing.attributes[attr] = info
    }

    // Classify each path based on its aggregated attributes
    for (const [p, item] of results.entries()) {
      const attrs = item.attributes
      const isBinary =
        attrs["binary"] === "set" ||
        attrs["diff"] === "unset" ||
        attrs["filter"] === "lfs" ||
        attrs["text"] === "unset"

      const isLfs = attrs["filter"] === "lfs"
      const eol = attrs["eol"]

      let lineEnding: "lf" | "crlf" | "auto" | undefined
      if (eol === "lf" || eol === "crlf") {
        lineEnding = eol
      } else if (attrs["text"] === "auto") {
        lineEnding = "auto"
      }

      results.set(p, {
        path: p,
        attributes: attrs,
        isBinary,
        isLfs,
        lineEnding,
      })
    }

    return results
  }
}
