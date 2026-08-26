/**
 * Attach to the busy renderer and use Debugger.pause (a V8 interrupt that works
 * mid-execution) to capture the call stack of whatever is hogging the main
 * thread. Samples several times.
 *
 * Usage: bun run scripts/debug/pause-stack.ts [samples] [navigateUrl]
 */
import WebSocket from "ws"

const SAMPLES = Number(process.argv[2] ?? 4)

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
  const scriptUrls = new Map<string, string>()
  let onPaused: ((frames: unknown[]) => void) | null = null

  ws.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message.result ?? message.error)
      pending.delete(message.id)
      return
    }
    if (message.method === "Debugger.scriptParsed" && message.params?.url) {
      scriptUrls.set(message.params.scriptId, message.params.url)
    }
    if (message.method === "Debugger.paused" && onPaused) {
      onPaused(message.params?.callFrames ?? [])
    }
  })

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  // Fire-and-forget variant for commands whose response may be delayed
  const sendNoWait = (method: string, params: Record<string, unknown> = {}) => {
    ws.send(JSON.stringify({ id: nextId++, method, params }))
  }

  await new Promise((resolve) => ws.on("open", resolve))
  sendNoWait("Debugger.enable")

  const navigateTo = process.argv[3]
  if (navigateTo) {
    console.log("Navigating to:", navigateTo)
    sendNoWait("Runtime.evaluate", {
      expression: `window.history.pushState({}, '', ${JSON.stringify(navigateTo)}); window.dispatchEvent(new PopStateEvent('popstate'))`,
    })
    // Give the leak a moment to start
    await new Promise((resolve) => setTimeout(resolve, 10000))
  }

  for (let sample = 1; sample <= SAMPLES; sample++) {
    console.log(`\n=== Pause sample ${sample}/${SAMPLES} ===`)
    const frames = await new Promise<unknown[]>((resolve) => {
      const timer = setTimeout(() => {
        onPaused = null
        resolve([{ timeout: true }])
      }, 30000)
      onPaused = (callFrames) => {
        clearTimeout(timer)
        onPaused = null
        resolve(callFrames)
      }
      sendNoWait("Debugger.pause")
    })

    for (const frame of frames.slice(0, 25) as Array<{
      functionName?: string
      url?: string
      location?: { scriptId: string; lineNumber: number }
      timeout?: boolean
    }>) {
      if (frame.timeout) {
        console.log("  (pause did not land within 30s — thread stuck in native/GC)")
        continue
      }
      const url = frame.url || scriptUrls.get(frame.location?.scriptId ?? "") || "?"
      const shortUrl = url.split("/").slice(-4).join("/")
      console.log(`  ${frame.functionName || "(anonymous)"} @ ${shortUrl}:${frame.location?.lineNumber}`)
    }

    sendNoWait("Debugger.resume")
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
