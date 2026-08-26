/**
 * Attach to the renderer at idle, start CPU profiling + console capture,
 * navigate to the leaking route, and stop the profile after a short window
 * (before the GC storm makes the thread unresponsive).
 *
 * Usage: bun run scripts/debug/early-profile.ts <navigateUrl> [durationSec]
 */
import WebSocket from "ws"

const NAVIGATE_URL = process.argv[2]
const DURATION_SEC = Number(process.argv[3] ?? 8)

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
  const consoleCounts = new Map<string, number>()

  ws.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result ?? message.error)
      pending.delete(message.id)
      return
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const args = (message.params?.args ?? []) as Array<{ value?: unknown; description?: string }>
      const preview = args
        .map((arg) => (typeof arg.value === "string" ? arg.value : (arg.description ?? JSON.stringify(arg.value))))
        .join(" ")
        .slice(0, 160)
      const key = `[${message.params?.type}] ${preview}`
      consoleCounts.set(key, (consoleCounts.get(key) ?? 0) + 1)
    }
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails
      const key = `[exception] ${detail?.text ?? ""} ${detail?.exception?.description?.slice(0, 160) ?? ""}`
      consoleCounts.set(key, (consoleCounts.get(key) ?? 0) + 1)
    }
  })

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP ${method} timed out`))
        }
      }, 60000)
    })

  await new Promise((resolve) => ws.on("open", resolve))

  await send("Runtime.enable")
  await send("Profiler.enable")
  await send("Profiler.setSamplingInterval", { interval: 500 })
  await send("Profiler.start")
  console.log("Profiler + console capture started")

  if (NAVIGATE_URL) {
    console.log("Navigating to:", NAVIGATE_URL)
    void send("Runtime.evaluate", {
      expression: `window.history.pushState({}, '', ${JSON.stringify(NAVIGATE_URL)}); window.dispatchEvent(new PopStateEvent('popstate'))`,
    }).catch(() => undefined)
  }

  console.log(`Sampling for ${DURATION_SEC}s...`)
  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000))

  const result = (await send("Profiler.stop")) as {
    profile?: { nodes: ProfileNode[] }
  }

  console.log("\n=== Console messages during window ===")
  const sortedConsole = Array.from(consoleCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [key, count] of sortedConsole) {
    console.log(`  x${count}  ${key}`)
  }

  const nodes = result?.profile?.nodes
  if (!nodes) {
    console.error("No profile:", JSON.stringify(result).slice(0, 300))
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
    const chain: string[] = []
    let cursor: number | undefined = node.id
    for (let depth = 0; depth < 14 && cursor !== undefined; depth++) {
      const parentId = parentById.get(cursor)
      if (parentId === undefined) break
      const parent = nodeById.get(parentId)
      if (!parent) break
      chain.push(frameLabel(parent))
      cursor = parentId
    }
    console.log(`    <- ${chain.slice(0, 10).join("\n    <- ")}`)
  }
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
