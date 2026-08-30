/**
 * Shared CDP plumbing for the interaction-performance harness.
 *
 * Connects to the Electron renderer over the remote debugging port
 * (`bun run dev:chrome-devtools` exposes 127.0.0.1:9222), installs a minimal
 * React DevTools hook stub before page load so React reports every commit,
 * and exposes helpers to count commits / long tasks around an interaction.
 */
import WebSocket from "ws"

const DEBUG_PORT = process.env.COZEA_PERF_DEBUG_PORT ?? "9222"

export async function connect() {
  let targets
  try {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  } catch {
    throw new Error(
      `No renderer on port ${DEBUG_PORT}. Start the app with \`bun run dev:chrome-devtools\` first.`,
    )
  }
  // Match the app renderer by title, then by dev-server/packaged origin, never
  // just the first page target. Other Electron pages can share the debug port.
  const pages = targets.filter((t) => t.type === "page")
  const page =
    pages.find((t) => t.title === "Cozea") ??
    pages.find((t) => /^(https?:\/\/(localhost|127\.0\.0\.1):\d+|file:)/.test(t.url ?? "")) ??
    pages[0]
  if (!page) throw new Error("No page target found on the debug port.")

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  await new Promise((resolve) => ws.on("open", resolve))
  await send("Page.enable")
  await send("Runtime.enable")
  return { ws, send }
}

const HOOK_SOURCE = `
  (() => {
    const hook = {
      isDisabled: false, supportsFiber: true, supportsFlight: false,
      renderers: new Map(), _commitRoots: [],
      inject(renderer) { const rid = this.renderers.size + 1; this.renderers.set(rid, renderer); return rid },
      checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      onCommitFiberRoot(rid, root) {
        try {
          if (window.__traceCommits) {
            const rendered = []
            const walk = (fiber, parentRendered) => {
              if (!fiber) return
              const didRender = (fiber.flags & 1) === 1
              let name = null
              const t = fiber.elementType
              if (typeof t === 'function') name = t.displayName || t.name || null
              else if (t && typeof t === 'object' && t.type) name = (t.type.displayName || t.type.name || null)
              if (didRender && name) rendered.push({ name, top: !parentRendered })
              let child = fiber.child
              while (child) { walk(child, didRender && name ? true : parentRendered); child = child.sibling }
            }
            walk(root.current, false)
            if (rendered.length > 0) hook._commitRoots.push({ at: performance.now(), entries: rendered })
          }
        } catch {}
      },
    }
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true })
  })()
`

/** Installs the commit-tracing hook and reloads so React picks it up. */
export async function installCommitHook(send, { settleMs = 14000 } = {}) {
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK_SOURCE })
  await send("Page.reload", { ignoreCache: false })
  await new Promise((resolve) => setTimeout(resolve, settleMs))
}

/** Evaluates an async expression in the page and parses its JSON result. */
export async function evalJson(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`Page evaluation failed: ${result.exceptionDetails.text}`)
  }
  return JSON.parse(result.result.value)
}

export function reportScenario(name, metrics, budget, violations) {
  const failed = Object.entries(budget).filter(([key, max]) => {
    const actual = metrics[key]
    return typeof actual === "number" && actual > max
  })
  const status = failed.length === 0 ? "PASS" : "FAIL"
  console.log(`\n[${status}] ${name}`)
  for (const [key, max] of Object.entries(budget)) {
    const actual = metrics[key]
    const mark = typeof actual === "number" && actual > max ? " <-- over budget" : ""
    console.log(`    ${key}: ${actual} (budget ${max})${mark}`)
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (!(key in budget)) console.log(`    ${key}: ${JSON.stringify(value)}`)
  }
  if (failed.length > 0) {
    violations.push({ name, failed: failed.map(([key]) => key) })
  }
}
