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
import { connect, installCommitHook, evalJson, reportScenario } from "./lib.mjs"

const BUDGETS = {
  tileSwitch: { commits: 4, totalRenders: 450 },
  sameTileReclick: { commits: 1, totalRenders: 50 },
  // Dominated by xterm re-attach (WebGL + font measure + GC), ~170ms per
  // terminal tile in the first project, inside the measured window since the
  // workspace-resolution SWR cache (R3) removed the revisit loading frame.
  // 450 covers the 2-terminal fixture; assistant-store resync itself is
  // content-fingerprinted and contributes ~0. Ratchet down when terminal
  // keep-alive across project switches lands.
  warmProjectSwitch: { totalBlockedMs: 450 },
  returnNavigation: { commits: 34, totalRenders: 3900 },
  ipcPerNavigation: { sessionStateChanged: 4, workbenchStore: 2 },
}

const { ws, send } = await connect()
const violations = []

console.log("Installing commit hook (reload + settle)...")
await installCommitHook(send)

// ── Scenario helpers (run in page) ──────────────────────────────────────────

const PAGE_HELPERS = `
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
      await window.__appRouter.navigate({ to: target })
      await new Promise((r) => setTimeout(r, 1500))
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
  const router = window.__appRouter
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
  const router = window.__appRouter
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

// ── Verdict ─────────────────────────────────────────────────────────────────

ws.close()
if (violations.length > 0) {
  console.error(`\n${violations.length} budget violation(s):`)
  for (const v of violations) console.error(`  - ${v.name}: ${v.failed.join(", ")}`)
  process.exit(1)
}
console.log("\nAll interaction budgets hold.")
process.exit(0)
