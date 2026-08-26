/**
 * Attach to the Electron renderer via CDP (port 9222), run a heap sampling
 * profile for N seconds, and print the top allocation sites.
 *
 * Usage: bun run scripts/debug/heap-sample.ts [durationSec]
 */
import WebSocket from "ws"

const DURATION_SEC = Number(process.argv[2] ?? 45)

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
}

interface SamplingNode {
  callFrame: CallFrame
  selfSize: number
  children?: SamplingNode[]
}

async function main() {
  const listResponse = await fetch("http://127.0.0.1:9222/json/list")
  const targets = (await listResponse.json()) as CdpTarget[]
  const page = targets.find(
    (target) => target.type === "page" && target.url.includes("localhost:5183"),
  )
  if (!page?.webSocketDebuggerUrl) {
    console.error("Renderer target not found. Targets:", targets.map((t) => `${t.type} ${t.url}`))
    process.exit(1)
  }
  console.log("Attached to:", page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1024 * 1024 * 1024 })
  let nextId = 1
  const pending = new Map<number, (result: unknown) => void>()

  ws.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result ?? message.error)
      pending.delete(message.id)
    }
  })

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await new Promise((resolve) => ws.on("open", resolve))

  const navigateTo = process.argv[3]
  if (navigateTo) {
    console.log("Navigating to:", navigateTo)
    await send("Runtime.evaluate", {
      expression: `window.history.pushState({}, '', ${JSON.stringify(navigateTo)}); window.dispatchEvent(new PopStateEvent('popstate'))`,
      returnByValue: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  const memBefore = (await send("Runtime.evaluate", {
    expression: "JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize} : null)",
    returnByValue: true,
  })) as { result?: { value?: string } }
  console.log("Heap before:", memBefore?.result?.value)

  await send("HeapProfiler.enable")
  await send("HeapProfiler.startSampling", { samplingInterval: 16384 })
  console.log(`Sampling for ${DURATION_SEC}s...`)
  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000))

  const profileResult = (await send("HeapProfiler.stopSampling")) as {
    profile?: { head: SamplingNode }
  }

  const memAfter = (await send("Runtime.evaluate", {
    expression: "JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize} : null)",
    returnByValue: true,
  })) as { result?: { value?: string } }
  console.log("Heap after:", memAfter?.result?.value)

  ws.close()

  const head = profileResult?.profile?.head
  if (!head) {
    console.error("No profile returned:", JSON.stringify(profileResult).slice(0, 500))
    process.exit(1)
  }

  // Aggregate self sizes by function+url
  const totals = new Map<string, number>()
  const stacks = new Map<string, string>()
  const walk = (node: SamplingNode, stack: string[]) => {
    const frame = `${node.callFrame.functionName || "(anonymous)"} @ ${node.callFrame.url.split("/").slice(-3).join("/")}:${node.callFrame.lineNumber}`
    const nextStack = [...stack, frame]
    if (node.selfSize > 0) {
      totals.set(frame, (totals.get(frame) ?? 0) + node.selfSize)
      if (!stacks.has(frame)) {
        stacks.set(frame, nextStack.slice(-6).join("\n    <- "))
      }
    }
    for (const child of node.children ?? []) {
      walk(child, nextStack)
    }
  }
  walk(head, [])

  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)
  console.log("\n=== Top allocation sites (self size) ===")
  for (const [frame, size] of sorted) {
    console.log(`\n${(size / 1024 / 1024).toFixed(1)} MB  ${frame}`)
    console.log(`    ${stacks.get(frame)}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
