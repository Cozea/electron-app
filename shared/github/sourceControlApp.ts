/**
 * The GitHub App Cozea uses to reach people's repositories: `cozea-source-control`,
 * owned by the Cozea organization.
 *
 * Installing it on an account is what lets a session save to Git and open pull
 * requests there; nothing here carries a secret.
 */

export const GITHUB_APP_SLUG = "cozea-source-control"

/** GitHub's page for installing the app, which returns `state` to Cozea's callback. */
export function githubAppInstallUrl(state?: string): string {
  const url = new URL(`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`)
  if (state) url.searchParams.set("state", state)
  return url.toString()
}

/** Where the account's owner changes which repositories the installation reaches. */
export function githubInstallationSettingsUrl(installation: {
  installationId: number
  accountLogin: string
  accountType: string
}): string {
  return installation.accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`
    : `https://github.com/settings/installations/${installation.installationId}`
}

/** The lowercased owner/name GitHub treats as one repository. */
export function githubRepositoryKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase()
}
