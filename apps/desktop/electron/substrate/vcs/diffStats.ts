/**
 * Line counts read off a unified diff we already have.
 *
 * The Changes read produces the patch anyway, so the header's "+12 −3" costs
 * nothing extra. Computing it from that same patch also means the counts and
 * the file list always describe one snapshot: asking Git twice used to let the
 * working tree move between the two answers.
 */

export interface DiffLineCounts {
  additions: number
  deletions: number
}

/**
 * Counts `+`/`-` lines inside hunks only.
 *
 * Tracking hunks rather than filtering `+++`/`---` prefixes matters for content
 * that looks like a header: deleting a line reading `--force` produces
 * `---force`, which prefix matching would discard as a file header. File
 * headers always precede the first `@@` of their file, so they never count.
 *
 * Binary files carry no hunk lines and so count as zero, which is also how
 * `--shortstat` reports them.
 */
export function countDiffLines(diff: string): DiffLineCounts {
  let additions = 0
  let deletions = 0
  let inHunk = false

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    // A new file's header ends the previous file's last hunk.
    if (line.startsWith("diff --git ")) {
      inHunk = false
      continue
    }
    if (!inHunk) continue

    if (line.startsWith("+")) additions += 1
    else if (line.startsWith("-")) deletions += 1
  }

  return { additions, deletions }
}
