/**
 * Attach to the busy Electron renderer via CDP and capture a CPU profile.
 * CPU sampling works even when the main thread is pegged (unlike Runtime.evaluate).
 *
 * Usage: bun run scripts/debug/cpu-sample.ts [durationSec]
 */
import WebSocket from "ws"

const DURATION_SEC = Number(process.argv[2] ?? 15)

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
  children?: number[]
}

async function main() {
  const listResponse = await fetch("http://127.0.0.1:9222/json/list")
  const targets = (await listResponse.json()) as CdpTarget[]
  const page = targets.find((target) => target.type === "page" && target.url.includes("localhost:5183"))
  if (!page?.webSocketDebuggerUrl) {
    console.error("No renderer target:", targets.map((t) => t.url))
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

  await send("Profiler.enable")
  await send("Profiler.setSamplingInterval", { interval: 500 })
  await send("Profiler.start")
  console.log("Profiler started")

  const navigateTo = process.argv[3]
  if (navigateTo) {
    console.log("Navigating to:", navigateTo)
    // Fire-and-forget: don't await, the main thread may get busy immediately
    void send("Runtime.evaluate", {
      expression: `window.history.pushState({}, '', ${JSON.stringify(navigateTo)}); window.dispatchEvent(new PopStateEvent('popstate'))`,
      returnByValue: true,
    })
  }

  console.log(`Profiling for ${DURATION_SEC}s...`)
  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000))

  const result = (await send("Profiler.stop")) as {
    profile?: { nodes: ProfileNode[]; samples?: number[] }
  }
  ws.close()

  const nodes = result?.profile?.nodes
  if (!nodes) {
    console.error("No profile:", JSON.stringify(result).slice(0, 400))
    process.exit(1)
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentById = new Map<number, number>()
  for (const node of nodes) {
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id)
    }
  }

  const frameLabel = (node: ProfileNode) =>
    `${node.callFrame.functionName || "(anonymous)"} @ ${node.callFrame.url.split("/").slice(-3).join("/")}:${node.callFrame.lineNumber}`

  const totalHits = nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0)
  const top = nodes
    .filter((node) => (node.hitCount ?? 0) > 0)
    .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
    .slice(0, 15)

  console.log(`\n=== Top self-time frames (total samples: ${totalHits}) ===`)
  for (const node of top) {
    const percent = (((node.hitCount ?? 0) / totalHits) * 100).toFixed(1)
    console.log(`\n${percent}%  ${frameLabel(node)}`)
    // Print ancestry chain
    const chain: string[] = []
    let cursor: number | undefined = node.id
    for (let depth = 0; depth < 12 && cursor !== undefined; depth++) {
      const parentId = parentById.get(cursor)
      if (parentId === undefined) break
      const parent = nodeById.get(parentId)
      if (!parent) break
      chain.push(frameLabel(parent))
      cursor = parentId
    }
    console.log(`    <- ${chain.slice(0, 8).join("\n    <- ")}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
