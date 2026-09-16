import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { extractGitHubRepoInfo, formatCloneErrorMessage } from "@/lib/git/gitErrorFormatting"

describe("extractGitHubRepoInfo", () => {
  it("extracts owner and repo from full https url with .git", () => {
    const info = extractGitHubRepoInfo("https://github.com/Depreck78/silk_road.git")
    expect(info).toEqual({
      repoName: "Depreck78/silk_road",
      webUrl: "https://github.com/Depreck78/silk_road",
    })
  })

  it("extracts owner and repo from https url with trailing slash", () => {
    const info = extractGitHubRepoInfo("https://github.com/Depreck78/silk_road.git/")
    expect(info).toEqual({
      repoName: "Depreck78/silk_road",
      webUrl: "https://github.com/Depreck78/silk_road",
    })
  })

  it("extracts owner and repo embedded in git error message", () => {
    const error = `git clone failed: Error: Cloning into '/Users/admin/Developer/Cozea/silk-road-1'...
remote: Repository not found.
fatal: repository 'https://github.com/Depreck78/silk_road.git/' not found`
    const info = extractGitHubRepoInfo(error)
    expect(info).toEqual({
      repoName: "Depreck78/silk_road",
      webUrl: "https://github.com/Depreck78/silk_road",
    })
  })

  it("extracts owner and repo from git ssh url", () => {
    const info = extractGitHubRepoInfo("git@github.com:Depreck78/silk_road.git")
    expect(info).toEqual({
      repoName: "Depreck78/silk_road",
      webUrl: "https://github.com/Depreck78/silk_road",
    })
  })

  it("returns null for non-github URLs", () => {
    expect(extractGitHubRepoInfo("https://gitlab.com/user/project.git")).toBeNull()
  })
})

describe("formatCloneErrorMessage", () => {
  it("formats clone access errors as a concise repo link", () => {
    const message = `Git command 'git clone' failed with exit code 128:
Cloning into '.'...
remote: Repository not found.
fatal: repository 'https://github.com/Depreck78/silk_road.git/' not found`
    const html = renderToStaticMarkup(<>{formatCloneErrorMessage(message)}</>)
    expect(html).toContain("Open Depreck78/silk_road on GitHub")
    expect(html).toContain("Depreck78/silk_road")
    expect(html).toContain("private repository")
    expect(html).not.toContain("exit code 128")
  })

  it("falls back to the raw message when the repo cannot be identified", () => {
    expect(formatCloneErrorMessage("some unexpected failure")).toBe("some unexpected failure")
    expect(formatCloneErrorMessage(null)).toBe("Failed to clone repository")
  })
})
