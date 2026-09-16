/**
 * What a Git failure was, decided in one place.
 *
 * Several screens classified failures with their own regular expressions, and
 * they had already drifted apart: one recognised a bare `401` and the other did
 * not; one recognised "could not read username" and "access denied" and the
 * other did not. The same failure got a different answer depending on which
 * screen the person happened to be looking at.
 *
 * Only the question moves here. The wording stays with each caller, because
 * they are answering different people: the Changes header offers a link to the
 * repository, while the invite flow explains that this particular Mac cannot
 * read it. Merging the sentences would make both worse.
 */

/**
 * The remote refused us, or does not admit to existing.
 *
 * Git says "repository not found" for a private repository the credentials
 * cannot see, so a missing repository and an unauthorised one are the same
 * answer here, and both lead the reader to check access.
 */
export function isRepositoryAccessFailure(detail: string | null | undefined): boolean {
  if (!detail) return false
  return /could not access|could not read username|repository not found|authentication failed|permission denied|access denied|\b403\b|\b401\b/i.test(
    detail,
  )
}

/**
 * The repository answered, but the branch asked for is not on it.
 *
 * Checked after {@link isRepositoryAccessFailure}: a remote that refuses us
 * cannot be said to be missing a branch, and Git's wording for the two can
 * overlap.
 */
export function isMissingRemoteBranchFailure(detail: string | null | undefined): boolean {
  if (!detail) return false
  return /remote branch .* not found|couldn't find remote ref|no such ref was fetched/i.test(detail)
}
