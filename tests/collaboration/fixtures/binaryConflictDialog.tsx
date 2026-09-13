import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { BinaryConflictDialog } from "../../../apps/desktop/src/features/collaboration/ui/BinaryConflictDialog"

async function checks() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let resolves = 0
  let fail = true
  let listed = 0
  let exports = 0
  const review = { fileId: "file", path: "image.bin", fingerprint: "a".repeat(64), variants: [
    { revisionId: "one", contentHash: "1".repeat(64), size: 20, createdAt: 1 },
    { revisionId: "two", contentHash: "2".repeat(64), size: 30, createdAt: 2 },
  ] }
  Object.assign(window, { electronAPI: { projectd: { sessions: { binaryConflicts: async (_id: string, request: { action: string; fingerprint?: string; revisionId?: string }) => {
    if (request.action === "list") { listed++; return { success: true, response: { conflicts: [review], nextFileId: null } } }
    if (request.action === "preview") return { success: true, response: { conflicts: [], nextFileId: null, preview: { revisionId: "one", size: 2, hex: "00 02", truncated: false, imageDataUrl: null } } }
    resolves++
    if (request.fingerprint !== review.fingerprint || request.revisionId !== "two") throw new Error("Wrong reviewed selection")
    return fail ? { success: false, error: "Conflict changed" } : { success: true, response: { conflicts: [], nextFileId: null, resolvedRevisionId: "resolved" } }
  }, exportBinaryVersion: async (_id: string, request: { revisionId: string; fingerprint: string }) => {
    if (request.revisionId !== "one" || request.fingerprint !== review.fingerprint) throw new Error("Wrong exported version")
    await new Promise((resolve) => setTimeout(resolve, 10))
    exports++
    return exports === 1 ? { success: true, canceled: true } : { success: true, canceled: false, response: { exportedPath: "/chosen/copy.bin" } }
  } } } } })
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 3000
    while (!check()) { if (Date.now() > deadline) throw new Error(`UI state did not arrive: ${check.toString()}`); await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label)!
  try {
    flushSync(() => root.render(<BinaryConflictDialog publicSessionId="session" canEdit onClose={() => {}} />))
    await wait(() => document.querySelectorAll('input[type="radio"]').length === 2)
    if (!button("Use selected version").disabled) throw new Error("Selection must be explicit")
    ;(document.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click()
    await wait(() => !button("Use selected version").disabled)
    button("Use selected version").click()
    await wait(() => document.querySelector('[role="alert"]') !== null)
    if (resolves !== 1 || !button("Use selected version").disabled) throw new Error("Stale review was reusable")
    button("Refresh").click()
    await wait(() => listed === 2 && document.querySelector('[role="alert"]') === null)
    fail = false
    ;(document.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click()
    await wait(() => !button("Use selected version").disabled)
    button("Use selected version").click()
    await wait(() => listed === 3 && document.body.textContent!.includes("Version selected"))
    flushSync(() => root.render(<BinaryConflictDialog publicSessionId="session" canEdit={false} onClose={() => {}} />))
    if (!button("Use selected version").disabled || !(document.querySelector('input[type="radio"]') as HTMLInputElement).disabled) throw new Error("Viewer could choose a version")
    button("Preview version").click()
    await wait(() => document.body.textContent!.includes("00 02"))
    if (Number(resolves) !== 2) throw new Error("Preview must not resolve a version")
    button("Export copy").click()
    await wait(() => exports === 1 && !button("Export copy").disabled)
    if (document.body.textContent!.includes("Copy exported")) throw new Error("Canceled export reported success")
    button("Export copy").click()
    await wait(() => document.body.textContent!.includes("Copy exported to /chosen/copy.bin"))
    if (Number(resolves) !== 2) throw new Error("Export must not resolve a version")
    return "BINARY_DIALOG_OK"
  } finally { flushSync(() => root.unmount()); container.remove() }
}
Object.assign(window, { runBinaryDialogChecks: checks })
