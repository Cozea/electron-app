import type { ReactNode } from "react"
import { GitHubIcon } from "@/components/integrations/IntegrationIcon"

export function extractGitHubRepoInfo(raw: string): { repoName: string; webUrl: string } | null {
  // Matches https://github.com/owner/repo or http://github.com/owner/repo
  const httpsMatch = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\/|\s|"|'|$)/.exec(raw)
  if (httpsMatch) {
    const owner = httpsMatch[1]
    const repo = httpsMatch[2].replace(/\.git$/, "")
    return {
      repoName: `${owner}/${repo}`,
      webUrl: `https://github.com/${owner}/${repo}`,
    }
  }

  // Matches git@github.com:owner/repo
  const scpMatch = /git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\/|\s|"|'|$)/.exec(raw)
  if (scpMatch) {
    const owner = scpMatch[1]
    const repo = scpMatch[2].replace(/\.git$/, "")
    return {
      repoName: `${owner}/${repo}`,
      webUrl: `https://github.com/${owner}/${repo}`,
    }
  }

  // Matches github.com/owner/repo
  const hostMatch = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\/|\s|"|'|$)/.exec(raw)
  if (hostMatch) {
    const owner = hostMatch[1]
    const repo = hostMatch[2].replace(/\.git$/, "")
    return {
      repoName: `${owner}/${repo}`,
      webUrl: `https://github.com/${owner}/${repo}`,
    }
  }

  return null
}

export function formatCloneErrorMessage(
  errorMessage: string | undefined | null,
  fallbackUrl?: string | null,
): ReactNode {
  if (!errorMessage) return "Failed to clone repository"

  const info = extractGitHubRepoInfo(errorMessage) ?? (fallbackUrl ? extractGitHubRepoInfo(fallbackUrl) : null)

  const isAccessDenied = /could not access|repository not found|authentication failed|permission denied|\b403\b|\b401\b/i.test(
    errorMessage,
  )

  if (info && isAccessDenied) {
    return (
      <span className="inline leading-relaxed">
        Git could not access{" "}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const openExternal = window.electronAPI?.shell?.openExternal
            if (openExternal) {
              void openExternal(info.webUrl)
            } else {
              window.open(info.webUrl, "_blank", "noopener,noreferrer")
            }
          }}
          className="inline-flex items-center gap-1 font-mono font-medium text-foreground underline underline-offset-2 hover:text-primary transition-colors cursor-pointer align-baseline"
          title={`Open ${info.repoName} on GitHub`}
        >
          <GitHubIcon className="size-3.5 inline shrink-0" />
          <span>{info.repoName}</span>
        </button>
        . If this is a private repository, verify that your GitHub account has been added as a collaborator and that your Git credentials have access.
      </span>
    )
  }

  return errorMessage
}
