/**
 * The GitHub repository a remote addresses, for the paths that must authorize
 * one exact repository.
 *
 * Three of these lived separately -- in the scoped network Git layer, the pull
 * request provider and the background repository authorization -- as
 * near-identical anchored regular expressions. They had drifted: only the
 * network layer accepted the `ssh://git@github.com/` form, so a session on such
 * a remote could fetch and push while no pull request could be opened for it.
 *
 * The pattern is anchored, and the accepted forms are deliberately narrow. In
 * particular the SSH forms require exactly `git@`, so a remote carrying
 * sign-in details -- `ssh://git:token@github.com/...` -- is refused here even
 * though the session layer stores such URLs verbatim. Authorizing a repository
 * is not the place to accept a credential smuggled through a URL.
 *
 * This answers only "which repository is this". Whether the caller may act on
 * it is decided elsewhere, against an operator-provisioned grant.
 */

export interface GitHubRepositoryScope {
  readonly owner: string
  readonly repository: string
  /** `owner/repo`, the form GitHub's REST API addresses. */
  readonly full: string
}

const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/

/**
 * The repository a GitHub remote names, or null when the URL is not one this
 * may authorize. Input is matched as given: callers that read a URL out of Git
 * trim it themselves, and trimming here would quietly accept remotes that the
 * anchored pattern is meant to refuse.
 */
export function parseGitHubRepository(remoteUrl: string): GitHubRepositoryScope | null {
  const match = GITHUB_REMOTE.exec(remoteUrl)
  if (!match) return null
  const owner = match[1]!
  const repository = match[2]!
  return { owner, repository, full: `${owner}/${repository}` }
}

/**
 * Whether two remotes name the same repository, compared case-insensitively as
 * GitHub itself treats owner and repository names.
 *
 * Takes the owner and name alone rather than a parsed scope, because callers
 * compare against an expectation they were handed, not against another URL.
 */
export function isSameGitHubRepository(
  left: { readonly owner: string; readonly repository: string },
  right: { readonly owner: string; readonly repository: string },
): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repository.toLowerCase() === right.repository.toLowerCase()
  )
}
