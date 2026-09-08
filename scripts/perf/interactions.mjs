/**
 * Interaction-performance regression harness.
 *
 * Run with the app started via `bun run dev:chrome-devtools`, then:
 *   bun run perf:interactions
 *
 * Scenarios and budgets reflect the 2026-06 render-performance work; if a
 * budget fails, something reintroduced a broadcast/cascade. Investigate with
 * the techniques documented in scripts/perf/README.md before raising budgets.
 */
import { connect, installCommitHook, evalJson, reportScenario, dispatchMouseDrag } from "./lib.mjs"

const BUDGETS = {
  tileSwitch: { commits: 4, totalRenders: 450 },
  sameTileReclick: { commits: 1, totalRenders: 50 },
  // Terminal keep-alive (TerminalViewHost) parks xterm instances across
  // project switches, so no font-atlas/scrollback rebuild happens on revisit.
  // The remainder is dev-mode route remount + GC (~200ms with two terminals);
  // assistant-store resync is content-fingerprinted and contributes ~0.
  warmProjectSwitch: { totalBlockedMs: 300 },
  returnNavigation: { commits: 34, totalRenders: 3900 },
  ipcPerNavigation: { sessionStateChanged: 4, workbenchStore: 2 },
  sidebarDrag: { syntheticResizeEvents: 0, sidebarWidthStoreWrites: 1 },
  changesSidebarDrag: { changesSidebarStoreWrites: 1 },
}

const { ws, send } = await connect()
const violations = []

console.log("Installing commit hook (reload + settle)...")
await installCommitHook(send)

// ── Scenario helpers (run in page) ──────────────────────────────────────────

const PAGE_HELPERS = `
  const waitForRouter = async () => {
    for (let i = 0; i < 50; i++) {
      if (window.__appRouter) return window.__appRouter
      await new Promise((r) => setTimeout(r, 100))
    }
    return window.__appRouter
  }
  const rows = () => Array.from(document.querySelectorAll('aside button, aside a, nav button, nav a, [class*="sidebar" i] button, [class*="sidebar" i] a'))
    .filter((el) => el.offsetParent !== null && el.textContent.trim().length > 0)
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
  const traceClick = async (el, settleMs = 900) => {
    const urlBefore = location.pathname + location.search
    hook._commitRoots.length = 0
    window.__traceCommits = true
    el.click()
    await new Promise((r) => setTimeout(r, settleMs))
    window.__traceCommits = false
    const commits = hook._commitRoots
    return {
      urlChanged: (location.pathname + location.search) !== urlBefore,
      commits: commits.length,
      totalRenders: commits.reduce((a, c) => a + c.entries.length, 0),
    }
  }
  const gotoFirstProjectWorkbench = async () => {
    const stored = JSON.parse(localStorage.getItem('cozea.projectSidebar.state.v1') ?? '{}')
    const firstId = stored.projectOrderIds?.[0]
    if (!firstId) return false
    const target = '/projects/p/' + firstId + '/workbench'
    if (location.pathname !== target) {
      const router = await waitForRouter()
      if (router) {
        await router.navigate({ to: target })
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    return true
  }
`

// ── 1. Tile switch + same-tile re-click ─────────────────────────────────────

const tile = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  await gotoFirstProjectWorkbench()
  const tileRows = () => Array.from(document.querySelectorAll('[data-sidebar-tile-row]'))
    .filter((el) => el.offsetParent !== null)
  if (tileRows().length < 2) return JSON.stringify({ skipped: 'need >=2 tile rows; have ' + tileRows().length })
  const [rowA, rowB] = tileRows()
  // Normalize: make rowA active (untraced), then measure a guaranteed switch
  // to rowB and a guaranteed same-tile re-click on rowB. The long settle lets
  // the post-navigation sync transient (#25, ~6s of convex-driven layout
  // commits) decay so the trace measures the click, not background noise.
  rowA.click()
  await new Promise((r) => setTimeout(r, 5000))
  const switchResult = await traceClick(rowB)
  const reclick = await traceClick(rowB)
  return JSON.stringify({ switch: switchResult, reclick })
})()`)

if (tile.skipped) {
  console.log(`\n[SKIP] tileSwitch: ${tile.skipped}`)
} else {
  reportScenario("tileSwitch (sidebar row, same project)", tile.switch, BUDGETS.tileSwitch, violations)
  if (tile.switch.urlChanged) violations.push({ name: "tileSwitch", failed: ["urlChanged (tile focus must not navigate)"] })
  reportScenario("sameTileReclick", tile.reclick, BUDGETS.sameTileReclick, violations)
}

// ── 2. Warm project switch: zero main-thread blocks ─────────────────────────

const warm = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  const stored = JSON.parse(localStorage.getItem('cozea.projectSidebar.state.v1') ?? '{}')
  const ids = stored.projectOrderIds ?? []
  if (ids.length < 2) return JSON.stringify({ skipped: 'need >=2 projects for switch scenario' })
  const router = window.__appRouter
  const hrefFor = (id) => '/projects/p/' + id + '/workbench'
  // Warm both targets first.
  await router.navigate({ to: hrefFor(ids[0]) }); await new Promise((r) => setTimeout(r, 1500))
  await router.navigate({ to: hrefFor(ids[1]) }); await new Promise((r) => setTimeout(r, 1500))
  const tasks = []
  const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) tasks.push(Math.round(e.duration)) })
  obs.observe({ entryTypes: ['longtask'] })
  await router.navigate({ to: hrefFor(ids[0]) })
  await new Promise((r) => setTimeout(r, 2500))
  obs.disconnect()
  return JSON.stringify({ totalBlockedMs: tasks.reduce((a, b) => a + b, 0), longTasks: tasks })
})()`)

if (warm.skipped) console.log(`\n[SKIP] warmProjectSwitch: ${warm.skipped}`)
else reportScenario("warmProjectSwitch", warm, BUDGETS.warmProjectSwitch, violations)

// ── 3. Return navigation commit count ───────────────────────────────────────

const nav = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  const router = await waitForRouter()
  if (!router) return JSON.stringify({ commits: 0, totalRenders: 0 })
  await gotoFirstProjectWorkbench()
  const base = location.pathname.replace(/\\/(workbench|changes|files|tasks)$/, '')
  await router.navigate({ to: base + '/changes' })
  await new Promise((r) => setTimeout(r, 800))
  hook._commitRoots.length = 0
  window.__traceCommits = true
  await router.navigate({ to: base + '/workbench' })
  await new Promise((r) => setTimeout(r, 1100))
  window.__traceCommits = false
  return JSON.stringify({
    commits: hook._commitRoots.length,
    totalRenders: hook._commitRoots.reduce((a, c) => a + c.entries.length, 0),
  })
})()`)
reportScenario("returnNavigation (changes -> workbench)", nav, BUDGETS.returnNavigation, violations)

// ── 4. IPC + store emissions per navigation ─────────────────────────────────

const ipc = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  const router = await waitForRouter()
  if (!router) return JSON.stringify({ skipped: 'router not ready' })
  await gotoFirstProjectWorkbench()
  const wb = window.__workbenchStore
  if (!wb || !window.electronAPI?.workbenchSession?.onStateChanged) {
    return JSON.stringify({ skipped: 'dev store globals unavailable' })
  }
  const counters = { sessionStateChanged: 0, workbenchStore: 0 }
  const unsubs = [
    wb.subscribe(() => { counters.workbenchStore++ }),
    window.electronAPI.workbenchSession.onStateChanged(() => { counters.sessionStateChanged++ }),
  ]
  const base = location.pathname.replace(/\\/(workbench|changes|files|tasks)$/, '')
  await router.navigate({ to: base + '/changes' })
  await new Promise((r) => setTimeout(r, 1200))
  await router.navigate({ to: base + '/workbench' })
  await new Promise((r) => setTimeout(r, 1200))
  for (const u of unsubs) { try { u() } catch {} }
  return JSON.stringify({ sessionStateChanged: counters.sessionStateChanged, workbenchStore: counters.workbenchStore })
})()`)

if (ipc.skipped) console.log(`\n[SKIP] ipcPerNavigation: ${ipc.skipped}`)
else reportScenario("ipcPerNavigation (round trip)", ipc, BUDGETS.ipcPerNavigation, violations)

// ── 5. Primary sidebar live drag ────────────────────────────────────────────

const sidebarRail = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  await gotoFirstProjectWorkbench()
  await new Promise((r) => setTimeout(r, 1000))
  const el = document.querySelector('[data-slot="sidebar-rail"]')
  if (!el) return JSON.stringify(null)
  const r = el.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`)

if (!sidebarRail) {
  console.log("\n[SKIP] sidebarDrag: sidebar rail not visible")
} else {
  await evalJson(send, `(() => {
    window.__cozeaInteractionCounters?.reset()
    return JSON.stringify({ ok: true })
  })()`)

  await dispatchMouseDrag(send, {
    from: { x: sidebarRail.x, y: sidebarRail.y },
    to: { x: sidebarRail.x + 80, y: sidebarRail.y },
    steps: 20,
    durationMs: 400,
  })
  await new Promise((r) => setTimeout(r, 200))

  const sidebarMetrics = await evalJson(send, `(() => {
    const c = window.__cozeaInteractionCounters?.get() ?? {}
    return JSON.stringify({
      syntheticResizeEvents: c.syntheticResizeEvents ?? 0,
      sidebarWidthStoreWrites: c.sidebarWidthStoreWrites ?? 0,
    })
  })()`)
  reportScenario("sidebarDrag (synthetic resize=0, store writes=1)", sidebarMetrics, BUDGETS.sidebarDrag, violations)
}

// ── 6. Changes sidebar live drag ────────────────────────────────────────────

const changesHandle = await evalJson(send, `(async () => {
  ${PAGE_HELPERS}
  await gotoFirstProjectWorkbench()
  await new Promise((r) => setTimeout(r, 600))
  if (window.__changesSidebarStore) {
    window.__changesSidebarStore.getState().actions.open()
  } else {
    const trigger = document.querySelector('[data-slot="changes-trigger"], button[aria-label*="Changes" i]')
    if (trigger) trigger.click()
  }
  await new Promise((r) => setTimeout(r, 600))
  const el = document.querySelector('[aria-label="Resize changes sidebar"], [data-workbench-changes-sidebar] [role="separator"]')
  if (!el) return JSON.stringify(null)
  const r = el.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`)

if (!changesHandle) {
  console.log("\n[SKIP] changesSidebarDrag: changes sidebar handle not found")
} else {
  await new Promise((r) => setTimeout(r, 400))
  await evalJson(send, `(() => {
    window.__cozeaInteractionCounters?.reset()
    return JSON.stringify({ ok: true })
  })()`)

  await dispatchMouseDrag(send, {
    from: { x: changesHandle.x, y: changesHandle.y },
    to: { x: changesHandle.x - 60, y: changesHandle.y },
    steps: 15,
    durationMs: 300,
  })
  await new Promise((r) => setTimeout(r, 200))

  const changesMetrics = await evalJson(send, `(() => {
    const c = window.__cozeaInteractionCounters?.get() ?? {}
    return JSON.stringify({
      changesSidebarStoreWrites: c.changesSidebarStoreWrites ?? 0,
    })
  })()`)
  reportScenario("changesSidebarDrag (store writes=1)", changesMetrics, BUDGETS.changesSidebarDrag, violations)
}

// ── Verdict ─────────────────────────────────────────────────────────────────

ws.close()
if (violations.length > 0) {
  console.error(`\n${violations.length} budget violation(s):`)
  for (const v of violations) console.error(`  - ${v.name}: ${v.failed.join(", ")}`)
  process.exit(1)
}
console.log("\nAll interaction budgets hold.")
process.exit(0)
