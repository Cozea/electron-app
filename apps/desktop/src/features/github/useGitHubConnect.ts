/**
 * Connecting this device to GitHub and linking a project's repository, for the
 * session toast, the GitHub settings page and onboarding.
 *
 * GitHub pages open in the browser. When the person returns, Convex already holds
 * the result, so the screens that asked update on their own; this hook only starts
 * the trip and says what to do next.
 */

import { useCallback, useState } from "react"
import { useAction } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { appToast } from "@/lib/appToast"
import { cleanConvexError } from "@/lib/convexError"
import { openExternalUrl } from "@/lib/electron/shellClient"
import { githubAppInstallUrl } from "@shared/github/sourceControlApp"

export type GitHubConnectMode = "install" | "sign_in"
type Busy = GitHubConnectMode | "link" | null

export function useGitHubConnect() {
  const startConnect = useAction(api.githubApp.startConnect)
  const linkProjectRepository = useAction(api.githubApp.linkProjectRepository)
  const [busy, setBusy] = useState<Busy>(null)

  const openGitHub = useCallback(async (mode: GitHubConnectMode, projectId?: Id<"projects">) => {
    const { url } = await startConnect({ mode, projectId })
    await openExternalUrl(url)
  }, [startConnect])

  const run = useCallback(async (kind: Exclude<Busy, null>, failure: string, work: () => Promise<void>) => {
    setBusy(kind)
    try {
      await work()
    } catch (error) {
      appToast.error({ title: failure, description: cleanConvexError(error, failure) })
    } finally {
      setBusy(null)
    }
  }, [])

  /** Opens GitHub to install the app (which also signs in) or only to sign in. */
  const connect = useCallback(
    (mode: GitHubConnectMode, projectId?: Id<"projects">) => run(mode, "Couldn't open GitHub", () => openGitHub(mode, projectId)),
    [openGitHub, run],
  )

  /** Links the project's repository, sending the person to GitHub first when something is missing. */
  const link = useCallback(
    (projectId: Id<"projects">, onLinked?: () => void) =>
      run("link", "Couldn't link the repository", async () => {
        const result = await linkProjectRepository({ projectId })
        switch (result.status) {
          case "linked":
            appToast.success({ title: `${result.owner}/${result.name} is linked`, description: "Sessions in this project can save to Git." })
            onLinked?.()
            return
          case "needs_github_account":
            await openGitHub("sign_in", projectId)
            appToast.info({ title: "Sign in on GitHub", description: "Cozea links the repository once you're back." })
            return
          case "not_installed":
            await openGitHub("install", projectId)
            appToast.info({
              title: "Install Cozea on GitHub",
              description: `Include ${result.owner}/${result.name}. Cozea links it once you're back.`,
            })
            return
          case "no_push_access":
            appToast.error({
              title: `@${result.login} can't push to ${result.owner}/${result.name}`,
              description: "Someone with write access to the repository needs to link it.",
            })
            return
          case "not_allowed":
            appToast.error({ title: "You can't link this project's repository", description: "Viewers can't change where a project saves." })
            return
          case "not_github":
            appToast.error({ title: "This project's repository isn't on GitHub" })
            return
          case "not_configured":
            appToast.error({ title: "GitHub isn't set up on this Cozea deployment" })
            return
        }
      }),
    [linkProjectRepository, openGitHub, run],
  )

  /** For a repository someone else owns: the plain install link, to send to them. */
  const copyInstallLink = useCallback(async (owner?: string) => {
    try {
      await navigator.clipboard.writeText(githubAppInstallUrl())
      appToast.success({
        title: "Install link copied",
        description: owner ? `Send it to whoever manages ${owner} on GitHub.` : "Send it to whoever manages the GitHub account.",
      })
    } catch {
      appToast.error({ title: "Couldn't copy the install link", description: githubAppInstallUrl() })
    }
  }, [])

  return { busy, connect, link, copyInstallLink }
}
