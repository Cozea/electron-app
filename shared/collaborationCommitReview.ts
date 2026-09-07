import { assertSharedFilePath } from "./collaborationPaths"

export interface CollaborationBinarySelection { path: string; reviewHash: string }
export interface CollaborationBinaryCandidate extends CollaborationBinarySelection {
  bytes: number
  executable: boolean
  change: "added" | "modified" | "deleted"
}
export interface CollaborationPreparedFileSummary {
  path: string
  binary: boolean
  additions: number | null
  deletions: number | null
}
export interface CollaborationPreparedReview {
  sessionId: string
  commitSha: string
  parentCommitSha: string
  throughSequence: number
  message: string
  files: CollaborationPreparedFileSummary[]
  patch: string
}

/** --numstat -z without rename detection: retain literal tabs/newlines/commas in
 * paths instead of splitting filenames on human display punctuation. */
export function parsePreparedNumstat(output: string): CollaborationPreparedFileSummary[] {
  if (output && !output.endsWith("\0")) throw new Error("Prepared file summary was truncated")
  const files = output.split("\0").filter(Boolean).map(row => {
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(row)
    if (!match || (match[1] === "-") !== (match[2] === "-")) throw new Error("Prepared file summary is invalid")
    const binary = match[1] === "-"
    const additions = binary ? null : Number(match[1])
    const deletions = binary ? null : Number(match[2])
    if ((!binary && (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)))) throw new Error("Prepared file summary exceeds its limit")
    return { path: assertSharedFilePath(match[3]!), binary, additions, deletions }
  })
  if (files.length > 10_000 || new Set(files.map(file => file.path)).size !== files.length) throw new Error("Prepared file summary contains duplicate or excessive paths")
  return files
}
