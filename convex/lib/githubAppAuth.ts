"use node"

/**
 * The cozea-source-control app's own credentials, for Node actions only.
 *
 * The app authenticates to GitHub with a short JWT signed by its private key; with
 * that it can ask where it is installed and mint installation tokens. The client
 * id and secret turn a person's sign-in code into a one-off user token.
 */

import { sign } from "node:crypto"

export interface GitHubAppCredentials {
  appId: string
  privateKey: string
}

export function githubAppCredentials(env: NodeJS.ProcessEnv = process.env): GitHubAppCredentials | null {
  const appId = env.COZEA_GITHUB_APP_ID ?? env.GITHUB_SOURCE_CONTROL_APP_ID
  const privateKey = (env.COZEA_GITHUB_APP_PRIVATE_KEY ?? env.GITHUB_SOURCE_CONTROL_APP_PRIVATE_KEY)?.replace(/\\n/g, "\n")
  return appId && privateKey ? { appId, privateKey } : null
}

export function githubAppClient(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.COZEA_GITHUB_CLIENT_ID ?? env.GITHUB_SOURCE_CONTROL_CLIENT_ID
  const clientSecret = env.COZEA_GITHUB_CLIENT_SECRET ?? env.GITHUB_SOURCE_CONTROL_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** A JWT GitHub accepts from the app for about nine minutes. */
export function signGitHubAppJwt(credentials: GitHubAppCredentials, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: credentials.appId })}`
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString("base64url")}`
}
