/**
 * The page a person sees in their browser after GitHub sends them back to Cozea.
 * Cozea itself notices the change through Convex, so the page only has to say
 * what happened and that they can go back.
 */

type LinkStatus =
  | { status: "linked"; owner: string; name: string }
  | { status: "not_allowed" }
  | { status: "not_github" }
  | { status: "needs_github_account" }
  | { status: "not_installed"; owner: string; name: string }
  | { status: "no_push_access"; login: string; owner: string; name: string }
  | { status: "not_configured" }

export type CallbackPageResult =
  | { ok: true; login: string | null; link: LinkStatus | null; installedOn?: string }
  | { ok: false; reason: "expired" | "not_configured" | "github_refused" }

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

function message(result: CallbackPageResult): { title: string; detail: string } {
  if (!result.ok) {
    switch (result.reason) {
      case "expired":
        return { title: "This link has expired", detail: "Start again from Cozea." }
      case "not_configured":
        return { title: "GitHub isn't set up on this Cozea deployment", detail: "Ask whoever runs Cozea to configure the GitHub App." }
      case "github_refused":
        return { title: "GitHub didn't confirm who you are", detail: "Start again from Cozea." }
    }
  }
  if (result.installedOn) {
    return {
      title: `Cozea is installed on ${result.installedOn}`,
      detail: "People in Cozea can now link its repositories to their projects. You can close this tab.",
    }
  }
  const signedIn = result.login ? `Signed in to GitHub as @${result.login}.` : "GitHub is connected."
  const link = result.link
  if (!link) return { title: "GitHub is connected", detail: `${signedIn} You can close this tab and return to Cozea.` }
  switch (link.status) {
    case "linked":
      return { title: `${link.owner}/${link.name} is linked`, detail: `${signedIn} Sessions in this project can save to Git. You can close this tab.` }
    case "not_installed":
      return {
        title: `The app isn't installed on ${link.owner}/${link.name}`,
        detail: `${signedIn} Install Cozea on that repository, or ask its owner to, then try again from Cozea.`,
      }
    case "no_push_access":
      return {
        title: `@${link.login} can't push to ${link.owner}/${link.name}`,
        detail: "Someone with write access to the repository needs to link it.",
      }
    case "needs_github_account":
      return { title: "GitHub didn't sign you in", detail: "Try again from Cozea and approve the sign-in on GitHub." }
    default:
      return { title: "GitHub is connected", detail: `${signedIn} The project's repository couldn't be linked from here; try again from Cozea.` }
  }
}

export function describeCallbackResult(result: CallbackPageResult): string {
  const { title, detail } = message(result)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cozea · GitHub</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.7; line-height: 1.5; }
</style>
</head>
<body><main><h1>${escape(title)}</h1><p>${escape(detail)}</p></main></body>
</html>`
}
