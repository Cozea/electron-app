/**
 * Machine-readable Git status parser using porcelain v2 with NUL-delimiters.
 *
 * Master Specification: Section 17.5
 * Command: `git status --porcelain=v2 -z --branch --untracked-files=normal`
 *
 * The parser itself lives in `shared/git/porcelainStatus.ts`, shared with the
 * desktop's Changes list.
 */

import { MAX_STATUS_FILES, parsePorcelainV2Status, type ParsedGitStatus } from "@shared/git/porcelainStatus"

export { MAX_STATUS_FILES, type GitFileStatus, type ParsedGitStatus } from "@shared/git/porcelainStatus"

export class GitStatusParser {
  static parsePorcelainV2(outputBuffer: Buffer | string, maxFiles: number = MAX_STATUS_FILES): ParsedGitStatus {
    const raw = typeof outputBuffer === "string" ? outputBuffer : outputBuffer.toString("utf8")
    return parsePorcelainV2Status(raw, maxFiles)
  }
}
