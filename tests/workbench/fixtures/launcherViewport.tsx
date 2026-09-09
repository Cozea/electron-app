import { useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { useLauncherGridLayout } from "../../../apps/desktop/src/features/workbench/useLauncherGridLayout"
import { useElementOverflowTitleFor } from "../../../apps/desktop/src/hooks/usePretextOverflowTitle"
import { LiveShimmerText } from "../../../apps/desktop/src/components/ui/live-shimmer-text"

// Exercise the real hook with Chromium geometry and React ref/effect lifecycles.
export async function runLauncherViewportChecks(): Promise<string[]> {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  let setGrid: (visible: boolean) => void = () => {}
  function Harness() {
    const [grid, updateGrid] = useState(false)
    setGrid = updateGrid
    const [ref, layout] = useLauncherGridLayout(20)
    return <>
      <output>{JSON.stringify(layout)}</output>
      {grid ? <div ref={ref} data-viewport style={{ width: 500, height: 240 }} /> : <span>List</span>}
    </>
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
  const checks: string[] = []
  const checkLayout = (columns: number, rows: number, label: string) => {
    const layout = JSON.parse(host.querySelector("output")!.textContent!)
    if (layout.columns !== columns || layout.rows !== rows) {
      throw new Error(`${label}: expected ${columns} columns/${rows} rows; got ${JSON.stringify(layout)}`)
    }
    checks.push(label)
  }
  try {
    flushSync(() => root.render(<Harness />))
    await settle()
    flushSync(() => setGrid(true))
    await settle()
    checkLayout(4, 2, "List to grid measures the newly mounted viewport")
    const first = host.querySelector<HTMLDivElement>("[data-viewport]")!
    first.style.width = "700px"
    first.style.height = "360px"
    await settle()
    checkLayout(6, 3, "Mounted grid responds to width and height changes")
    flushSync(() => setGrid(false))
    await settle()
    flushSync(() => setGrid(true))
    await settle()
    checkLayout(4, 2, "Grid to list to grid attaches to the replacement viewport")
    first.style.width = "100px"
    await settle()
    checkLayout(4, 2, "Detached viewport no longer controls the layout")
    return checks
  } finally {
    root.unmount()
    host.remove()
  }
}

async function runSidebarOverflowChecks(): Promise<string[]> {
  const host = document.createElement("div")
  host.style.width = "100px"
  document.body.append(host)
  // Only the layout utilities needed by the production shimmer text are relevant.
  const style = document.createElement("style")
  style.textContent = `
    .block { display: block } .inline-block { display: inline-block }
    .w-full { width: 100% } .max-w-full { max-width: 100% }
    .overflow-hidden, .truncate { overflow: hidden }
    .truncate { white-space: nowrap; text-overflow: ellipsis }
    .relative { position: relative } .absolute { position: absolute }
  `
  document.head.append(style)
  const root = createRoot(host)
  let setRunning: (running: boolean) => void = () => {}
  const text = "A very long project title that cannot fit in a narrow sidebar"
  function Harness() {
    const [running, updateRunning] = useState(false)
    setRunning = updateRunning
    const { elementRef, overflowTitle } = useElementOverflowTitleFor<HTMLSpanElement>(text)
    return <div title={overflowTitle} data-title>
      {running
        ? <LiveShimmerText textRef={elementRef} className="w-full">{text}</LiveShimmerText>
        : <span ref={elementRef} className="block truncate">{text}</span>}
    </div>
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
  const checks: string[] = []
  const checkTitle = (expected: string, label: string) => {
    const title = host.querySelector<HTMLElement>("[data-title]")!.title
    if (title !== expected) throw new Error(`${label}: got ${JSON.stringify(title)}`)
    checks.push(label)
  }
  try {
    flushSync(() => root.render(<Harness />))
    await settle()
    checkTitle(text, "Clipped idle sidebar title has a tooltip")
    flushSync(() => setRunning(true))
    await settle()
    checkTitle(text, "Clipped running sidebar title retains its tooltip")
    host.style.width = "2000px"
    await settle()
    checkTitle("", "Running title tooltip clears when the new text node fits")
    host.style.width = "100px"
    await settle()
    checkTitle(text, "Running title tooltip returns after narrowing")
    flushSync(() => setRunning(false))
    host.style.width = "2000px"
    await settle()
    checkTitle("", "Idle title observer reattaches after the running state ends")
    return checks
  } finally {
    root.unmount()
    host.remove()
    style.remove()
  }
}

Object.assign(window, {
  runMeasurementChecks: async () => [
    ...await runLauncherViewportChecks(),
    ...await runSidebarOverflowChecks(),
  ],
})
