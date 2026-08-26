/**
 * Attach to the renderer, navigate to a route, and stream console messages /
 * exceptions live. Works even when the main thread wedges, because inspector
 * events are emitted as the JS executes.
 *
 * Usage: bun run scripts/debug/console-watch.ts <navigateUrl> [durationSec]
 */
import WebSocket from "ws"

const NAVIGATE_URL = process.argv[2]
const DURATION_SEC = Number(process.argv[3] ?? 30)

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
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
  const counts = new Map<string, number>()
  let eventCount = 0

  ws.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result ?? message.error)
      pending.delete(message.id)
      return
    }
    let key: string | null = null
    if (message.method === "Runtime.consoleAPICalled") {
      const args = (message.params?.args ?? []) as Array<{ value?: unknown; description?: string }>
      const preview = args
        .map((arg) => (typeof arg.value === "string" ? arg.value : (arg.description ?? String(arg.value))))
        .join(" | ")
        .replace(/\s+/g, " ")
        .slice(0, 800)
      key = `[${message.params?.type}] ${preview}`
      // Full stack for warnings/errors to locate the caller
      const frames = (message.params?.stackTrace?.callFrames ?? []) as Array<{
        functionName?: string
        url?: string
        lineNumber?: number
      }>
      if (frames.length > 0 && (message.params?.type === "warning" || message.params?.type === "error")) {
        key += "\n" + frames
          .slice(0, 30)
          .map((f) => `      at ${f.functionName || "(anon)"} (${String(f.url).split("/").slice(-3).join("/")}:${f.lineNumber})`)
          .join("\n")
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails
      key = `[exception] ${detail?.text ?? ""} ${(detail?.exception?.description ?? "").replace(/\s+/g, " ").slice(0, 220)}`
    }
    if (key) {
      eventCount++
      const previous = counts.get(key) ?? 0
      counts.set(key, previous + 1)
      if (previous === 0) {
        console.log(`NEW  ${key}`)
      }
    }
  })

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const sendNoWait = (method: string, params: Record<string, unknown> = {}) => {
    ws.send(JSON.stringify({ id: nextId++, method, params }))
  }

  await new Promise((resolve) => ws.on("open", resolve))
  await send("Runtime.enable")

  if (NAVIGATE_URL) {
    console.log("Navigating to:", NAVIGATE_URL)
    sendNoWait("Runtime.evaluate", {
      expression: `window.history.pushState({}, '', ${JSON.stringify(NAVIGATE_URL)}); window.dispatchEvent(new PopStateEvent('popstate'))`,
    })
  }

  console.log(`Listening for ${DURATION_SEC}s...`)
  const start = Date.now()
  while (Date.now() - start < DURATION_SEC * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    console.log(`--- t=${Math.round((Date.now() - start) / 1000)}s, total events: ${eventCount}`)
  }

  console.log("\n=== Message counts ===")
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25)
  for (const [key, count] of sorted) {
    console.log(`  x${count}  ${key}`)
  }
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
