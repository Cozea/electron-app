import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { ResponsiveHeaderRow } from "../../../apps/desktop/src/components/layouts/unified-header/ResponsiveHeaderRow"

import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from "../../../apps/desktop/src/components/ui/dialog"
import { useHeaderOverflow } from "../../../apps/desktop/src/components/layouts/unified-header/HeaderOverflowContext"

Object.assign(window, { runHeaderOverflowChecks })

async function runHeaderOverflowChecks() {
  const host = document.createElement("div")
  host.style.width = "750px"
  document.body.append(host)
  const styles = document.createElement("style")
  styles.textContent = `
    * { box-sizing: border-box; } body { font: 13px sans-serif; margin: 0; }
    button { height: 28px; border: 0; padding: 0; }
    .responsive-header-row { height: 40px; }
    .responsive-header-overflow { width: 28px; }
    .responsive-header-popup { background: white; padding: 12px; }
  `
  document.head.append(styles)
  const root = createRoot(host)
  let mounts = 0
  let updateLabel: (label: string) => void = () => {}
  let updateLeading: (width: number) => void = () => {}
  let updateItems: (show: boolean) => void = () => {}
  function Action({ id, width }: { id: string; width: number }) {
    const [count, setCount] = useState(0)
    const [dialog, setDialog] = useState(false)
    const overflow = useHeaderOverflow()
    useEffect(() => { mounts++ }, [])
    if (id === "share") return <Dialog open={dialog} onOpenChange={(next) => { setDialog(next); if (next) overflow?.dismiss() }}>
      <DialogTrigger data-action="share" style={{ width }}>Share</DialogTrigger>
      <DialogContent finalFocus={overflow?.returnFocus}><DialogTitle>Share fixture</DialogTitle><DialogClose>Done</DialogClose></DialogContent>
    </Dialog>
    return <button data-action={id} style={{ width }} onClick={() => setCount(count + 1)}>{id}: {count}</button>
  }
  function Harness() {
    const [label, setLabel] = useState("A long project name and branch")
    const [leading, setLeading] = useState(34)
    const [show, setShow] = useState(true)
    updateLabel = setLabel
    updateLeading = setLeading
    updateItems = setShow
    return <ResponsiveHeaderRow
      leading={<div style={{ width: leading }} />}
      title={<span style={{ width: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>}
      center={<span>Center content with a very long name</span>}
      groups={show ? [
        { id: "changes", label: "Changes", priority: 80, content: <Action id="changes" width={80} /> },
        { id: "editor", label: "Editor", priority: 30, content: <Action id="editor" width={50} /> },
        { id: "share", label: "Share", priority: 20, content: <Action id="share" width={28} /> },
      ] : []}
      style={{ paddingLeft: 70 }}
    />
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 70))
  const checks: string[] = []
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
    checks.push(message)
  }
  const hidden = () => [...host.querySelectorAll<HTMLElement>(".responsive-header-slot[data-overflowed] [data-header-group]")].map((item) => item.dataset.headerGroup).join(",")
  const resize = async (width: number) => { host.style.width = `${width}px`; await settle() }
  try {
    flushSync(() => root.render(<Harness />))
    await settle()
    const editor = host.querySelector<HTMLButtonElement>("[data-action=editor]")!
    editor.click()
    await settle()
    assert(hidden() === "", "Wide header displays all actions")
    await resize(390)
    assert(hidden().includes("editor") && hidden().includes("share"), "Narrow header overflows lower priorities together")
    const snapshot = hidden()
    for (const width of [391, 390, 392, 389, 393, 390]) await resize(width)
    assert(hidden() === snapshot, "Small reversals do not oscillate visibility")
    assert(editor.textContent === "editor: 1" && mounts === 3, "Overflow retains component state and subscriptions")
    const trigger = host.querySelector<HTMLButtonElement>("[aria-label='More header actions']")!
    trigger.click()
    await settle()
    const popup = document.querySelector<HTMLElement>("[data-slot=popover-content]")!
    assert(Boolean(popup?.contains(editor)), "Overflow opens the original controls in the shared portal")
    editor.click()
    await settle()
    assert(editor.textContent === "editor: 2", "Overflow actions remain functional")
    await resize(750)
    assert(popup.contains(editor), "Open overflow contents stay stable during resize")
    trigger.click()
    await settle()
    ;(document.activeElement as HTMLElement)?.blur()
    await resize(751)
    assert(hidden() === "" && host.contains(editor), "Closing overflow restores controls when headroom returns")
    assert(editor.textContent === "editor: 2" && mounts === 3, "Returning inline preserves the original state")
    editor.focus()
    await resize(320)
    assert(document.activeElement === editor && !editor.closest<HTMLElement>("[inert]"), "Focused action is not hidden during resize")
    editor.blur()
    await settle()
    assert(hidden().includes("editor"), "Blur releases the focused action for overflow")
    trigger.click()
    await settle()
    document.querySelector<HTMLButtonElement>("[data-action=share]")!.click()
    await settle()
    assert(Boolean(document.querySelector("[data-slot=dialog-content]")), "Dialog opened from overflow stays mounted")
    assert(trigger.getAttribute("aria-expanded") === "false", "Opening a dialog dismisses overflow without stealing focus")
    document.querySelector<HTMLButtonElement>("[data-slot=dialog-close]")!.click()
    await settle()
    assert(document.activeElement === trigger, "Dialog returns focus to the visible overflow trigger")
    trigger.blur()
    await resize(450)
    flushSync(() => updateLeading(180))
    await settle()
    assert(hidden().includes("changes"), "Leading control width participates in the budget")
    flushSync(() => updateLeading(34))
    flushSync(() => updateLabel("Different project name"))
    await resize(750)
    assert(hidden() === "", "Content changes and regained width restore the row")
    flushSync(() => updateItems(false))
    await settle()
    assert(trigger.hidden, "Removed groups do not leave an empty overflow trigger")
    return checks
  } finally {
    root.unmount()
    host.remove()
    styles.remove()
  }
}
