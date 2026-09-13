import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { MergeSessionDialog } from "../../../apps/desktop/src/features/collaboration/ui/MergeSessionDialog"

async function checks() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let requests = 0
  let merges = 0
  const checkpoint = "a".repeat(40)
  const target = "b".repeat(40)
  Object.assign(window, { electronAPI: { projectd: { sessions: {
    previewMerge: async () => ({ success: true, preview: { branch: "session", targetBranch: "main", checkpointOid: checkpoint,
      targetOid: target, ahead: 1, behind: 0, clean: true, conflictingPaths: [], unsavedChanges: 0, pullRequestUrl: null, canCreatePullRequest: true } }),
    createPullRequest: async (_id: string, head: string, base: string) => {
      requests++
      if (head !== checkpoint || base !== target) throw new Error("Review lost")
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { success: true, result: { number: 7, url: "https://github.com/team/app/pull/7", state: "open", created: true } }
    }, merge: async () => { merges++; throw new Error("PR must not merge") },
  } }, shell: { openExternal: async () => {} } } })
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 3000
    while (!check()) { if (Date.now() > deadline) throw new Error("PR dialog timed out"); await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label)
  try {
    flushSync(() => root.render(<MergeSessionDialog isOpen onOpenChange={() => {}} publicSessionId="session" branchName="session" targetBranch="main" canManage onPause={() => {}} onEnd={() => {}} />))
    await wait(() => Boolean(button("Create or find PR")))
    button("Create or find PR")!.click()
    button("Create or find PR")!.click()
    await wait(() => document.body.textContent!.includes("Pull request #7 is open."))
    if (requests !== 1 || merges !== 0 || !button("Open pull request")) throw new Error("Incorrect PR action/result")
    return "PR_DIALOG_OK"
  } finally { flushSync(() => root.unmount()); container.remove() }
}
Object.assign(window, { runPullRequestChecks: checks })
