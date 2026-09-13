import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { StructuralConflictDialog } from "../../../apps/desktop/src/features/collaboration/ui/StructuralConflictDialog"

async function checks() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let calls = 0
  let fail = true
  let lists = 0
  Object.assign(window, { electronAPI: { projectd: { sessions: { structuralConflicts: async (_id: string, request: { action: string; choice?: string; fingerprint?: string; path?: string }) => {
    if (request.action === "list") { lists++; return { success: true, response: { conflicts: [{ fileId: "file", path: "old.txt", deleted: true,
      kinds: ["delete_modify"], alternatives: ["recovered.txt"], fingerprint: "reviewed" }], nextFileId: null } } }
    calls++
    if (request.choice !== "restore" || request.path !== "recovered.txt" || request.fingerprint !== "reviewed") throw new Error("Wrong reviewed choice")
    return fail ? { success: false, error: "Conflict changed" } : { success: true, response: { conflicts: [], nextFileId: null } }
  } } } } })
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 3000
    while (!check()) { if (Date.now() > deadline) throw new Error("UI state did not arrive"); await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  const button = (text: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === text)
  try {
    flushSync(() => root.render(<StructuralConflictDialog publicSessionId="session" canEdit onClose={() => {}} />))
    await wait(() => Boolean(button("Restore file")))
    if (button("Apply resolution")) throw new Error("Resolution must be explicit")
    button("Keep deleted")!.click()
    await wait(() => document.body.textContent!.includes("will be deleted"))
    if (calls !== 0) throw new Error("Choosing deletion must not apply it")
    button("Restore file")!.click()
    await wait(() => Boolean(button("Use recovered.txt")))
    button("Use recovered.txt")!.click()
    await wait(() => (document.querySelector("input") as HTMLInputElement).value === "recovered.txt")
    button("Apply resolution")!.click()
    await wait(() => Boolean(document.querySelector('[role="alert"]')))
    if (button("Apply resolution")) throw new Error("Stale choice remained usable")
    fail = false
    button("Refresh")!.click()
    await wait(() => lists === 2 && !document.querySelector('[role="alert"]'))
    button("Restore file")!.click()
    await wait(() => Boolean(button("Use recovered.txt")))
    button("Use recovered.txt")!.click()
    await wait(() => (document.querySelector("input") as HTMLInputElement).value === "recovered.txt")
    button("Apply resolution")!.click()
    await wait(() => lists === 3 && document.body.textContent!.includes("Resolution recorded"))
    flushSync(() => root.render(<StructuralConflictDialog publicSessionId="session" canEdit={false} onClose={() => {}} />))
    if (!(document.querySelector("fieldset") as HTMLFieldSetElement).disabled) throw new Error("Viewer has editing controls")
    return "STRUCTURAL_DIALOG_OK"
  } finally { flushSync(() => root.unmount()); container.remove() }
}
Object.assign(window, { runStructuralDialogChecks: checks })
