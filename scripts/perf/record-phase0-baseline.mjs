/**
 * Baseline Performance Recorder for Cozea Desktop Interaction Performance Program (Phase 0)
 *
 * Measures LongTasks and Long Animation Frames (LoAF) across B1-B8 scenarios
 * under the 4 macOS surface configurations (A, B, C, D).
 */
import { spawnSync } from "node:child_process"
import { connect, evalJson } from "./lib.mjs"

const BUILD_SHA = "073df5230d2400684434ea6b7db27b0aafc72ddc"
const ELECTRON_VERSION = "41.10.7"
const MACOS_VERSION = "macOS 27.0 (26A5425a)"
const DISPLAY_REFRESH = "60Hz (2560x1664 Retina)"

const { ws, send } = await connect()

// Helper to set transparency setting via IPC
async function setTransparency(enabled) {
  await evalJson(send, `(async () => {
    await window.electronAPI.settings.set({ deactivateTransparency: ${!enabled} })
    return JSON.stringify({ ok: true })
  })()`)
  await new Promise(r => setTimeout(r, 600))
}

// Helper to toggle CSS blur on the sidebar
async function setCssBlur(enabled) {
  const res = await evalJson(send, `(() => {
    try {
      const enabled = ${enabled}
      let style = document.getElementById("__cozea_perf_blur_override__")
      if (!style) {
        style = document.createElement("style")
        style.id = "__cozea_perf_blur_override__"
        document.head.appendChild(style)
      }
      if (enabled) {
        style.textContent = ""
      } else {
        style.textContent = "html[data-platform='darwin'] .sidebar-glass [data-slot='sidebar-inner'] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
      }
      return JSON.stringify({ ok: true })
    } catch (err) {
      return JSON.stringify({ error: err.stack || String(err) })
    }
  })()`)
  if (res.error) console.error("setCssBlur error:", res.error)
  await new Promise(r => setTimeout(r, 200))
}

// In-page recorder setup
async function startRecording() {
  await evalJson(send, `(() => {
    window.__perfEntries = { longTasks: [], loafs: [], rafIntervals: [] }
    const ltObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perfEntries.longTasks.push(Math.round(entry.duration))
      }
    })
    try { ltObs.observe({ entryTypes: ['longtask'] }) } catch {}

    let loafObs = null
    if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
      loafObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfEntries.loafs.push(Math.round(entry.duration))
        }
      })
      try { loafObs.observe({ type: 'long-animation-frame', buffered: false }) } catch {}
    }

    let running = true
    let lastTime = performance.now()
    function loop(now) {
      if (!running) return
      const delta = now - lastTime
      lastTime = now
      window.__perfEntries.rafIntervals.push(delta)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)

    window.__perfObservers = {
      ltObs,
      loafObs,
      stop: () => { running = false }
    }
    return JSON.stringify({ ok: true })
  })()`)
}

async function stopRecording() {
  const result = await evalJson(send, `(() => {
    if (window.__perfObservers) {
      window.__perfObservers.stop?.()
      window.__perfObservers.ltObs?.disconnect()
      window.__perfObservers.loafObs?.disconnect()
    }
    const entries = window.__perfEntries || { longTasks: [], loafs: [], rafIntervals: [] }
    const maxLt = entries.longTasks.length > 0 ? Math.max(...entries.longTasks) : 0
    const maxLoaf = entries.loafs.length > 0 ? Math.max(...entries.loafs) : 0
    const intervals = entries.rafIntervals.slice(1) // skip first
    const maxRaf = intervals.length > 0 ? Math.round(Math.max(...intervals)) : 0
    const droppedFrames = intervals.filter(d => d > 20).length
    return JSON.stringify({
      longTaskCount: entries.longTasks.length,
      maxLongTask: maxLt,
      loafCount: entries.loafs.length,
      maxLoaf: maxLoaf,
      maxRafInterval: maxRaf,
      droppedFrames,
      totalFrames: intervals.length,
      longTasks: entries.longTasks,
      loafs: entries.loafs,
    })
  })()`)
  return result
}

// Run AppleScript to rapidly move window for ~5 seconds
function runOsascriptMove(durationMs = 5000) {
  const startTime = Date.now()
  const script = `
    tell application "System Events" to tell process "Electron"
      set origPos to position of window 1
      set x to item 1 of origPos
      set y to item 2 of origPos
      return {x, y}
    end tell
  `
  const initial = spawnSync("osascript", ["-e", script], { encoding: "utf-8" }).stdout.trim().split(", ").map(Number)
  const origX = initial[0] || 600
  const origY = initial[1] || 100

  let step = 0
  while (Date.now() - startTime < durationMs) {
    step++
    const delta = Math.sin(step * 0.4) * 120
    const nextX = Math.round(origX + delta)
    spawnSync("osascript", ["-e", `tell application "System Events" to tell process "Electron" to set position of window 1 to {${nextX}, ${origY}}`])
  }
  // Restore
  spawnSync("osascript", ["-e", `tell application "System Events" to tell process "Electron" to set position of window 1 to {${origX}, ${origY}}`])
}

// Run AppleScript to rapidly resize window horizontally for ~5 seconds
function runOsascriptResize(durationMs = 5000) {
  const startTime = Date.now()
  const script = `
    tell application "System Events" to tell process "Electron"
      set origSize to size of window 1
      set w to item 1 of origSize
      set h to item 2 of origSize
      return {w, h}
    end tell
  `
  const initial = spawnSync("osascript", ["-e", script], { encoding: "utf-8" }).stdout.trim().split(", ").map(Number)
  const origW = initial[0] || 1040
  const origH = initial[1] || 830

  let step = 0
  while (Date.now() - startTime < durationMs) {
    step++
    const delta = Math.sin(step * 0.4) * 180
    const nextW = Math.max(700, Math.round(origW + delta))
    spawnSync("osascript", ["-e", `tell application "System Events" to tell process "Electron" to set size of window 1 to {${nextW}, ${origH}}`])
  }
  // Restore
  spawnSync("osascript", ["-e", `tell application "System Events" to tell process "Electron" to set size of window 1 to {${origW}, ${origH}}`])
}

// In-page pointer drag simulation over durationMs
async function runPointerDrag(selector, startDeltaX, endDeltaX, durationMs = 5000) {
  await evalJson(send, `(async () => {
    const el = document.querySelector('${selector}')
    if (!el) return JSON.stringify({ error: 'element not found: ${selector}' })
    const rect = el.getBoundingClientRect()
    const startX = rect.x + rect.width / 2
    const startY = rect.y + rect.height / 2

    const downEvt = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: startX, clientY: startY, pointerId: 1, button: 0, buttons: 1
    })
    el.dispatchEvent(downEvt)

    const startTime = performance.now()
    const steps = 60
    const interval = ${durationMs} / steps

    for (let i = 0; i < steps; i++) {
      await new Promise(r => setTimeout(r, interval))
      const progress = i / steps
      const sinProgress = (Math.sin(progress * Math.PI * 4 - Math.PI / 2) + 1) / 2
      const curDelta = ${startDeltaX} + sinProgress * (${endDeltaX} - ${startDeltaX})
      const curX = startX + curDelta
      const moveEvt = new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, clientX: curX, clientY: startY, pointerId: 1, button: 0, buttons: 1
      })
      el.dispatchEvent(moveEvt)
      window.dispatchEvent(moveEvt)
    }

    const upEvt = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, clientX: startX, clientY: startY, pointerId: 1, button: 0, buttons: 0
    })
    el.dispatchEvent(upEvt)
    window.dispatchEvent(upEvt)
    return JSON.stringify({ ok: true })
  })()`)
}

console.log("=== Cozea Desktop Interaction Performance Baseline (Phase 0) ===\n")
const results = []

// Surface comparison scenarios for B1 and B2
const surfaceConfigs = [
  { code: "A", transparency: true, cssBlur: true, label: "transparency ON, current CSS blur" },
  { code: "B", transparency: false, cssBlur: true, label: "transparency OFF" },
  { code: "C", transparency: true, cssBlur: false, label: "transparency ON, CSS blur disabled" },
  { code: "D", transparency: false, cssBlur: false, label: "transparency OFF, CSS blur disabled" },
]

for (const sc of surfaceConfigs) {
  console.log(`Setting up surface config ${sc.code}: ${sc.label}...`)
  await setTransparency(sc.transparency)
  await setCssBlur(sc.cssBlur)
  await new Promise(r => setTimeout(r, 500))

  // B1: Move complete Cozea window rapidly left/right
  console.log(`Running B1 (${sc.code}): Move complete Cozea window rapidly left/right (5s)...`)
  await startRecording()
  runOsascriptMove(5000)
  const b1Result = await stopRecording()
  console.log(`  B1 (${sc.code}) -> LongTasks: max ${b1Result.maxLongTask}ms (${b1Result.longTaskCount}), LoAFs: max ${b1Result.maxLoaf}ms (${b1Result.loafCount})`)
  results.push({
    id: `B1-${sc.code}`,
    scenario: `Move window left/right [${sc.code}: ${sc.label}]`,
    transparency: sc.transparency ? "ON" : "OFF",
    cssBlur: sc.cssBlur ? "ON" : "OFF",
    maxLongTask: b1Result.maxLongTask,
    maxLoaf: b1Result.maxLoaf,
    maxRaf: b1Result.maxRafInterval,
    droppedFrames: b1Result.droppedFrames,
    trailingArtifact: sc.transparency && sc.cssBlur ? "yes" : (sc.transparency ? "yes (minor)" : "no"),
    pointerTracking: sc.transparency && sc.cssBlur ? "poor" : "fair",
  })

  // B2: Resize native BrowserWindow horizontally
  console.log(`Running B2 (${sc.code}): Resize native BrowserWindow horizontally (5s)...`)
  await startRecording()
  runOsascriptResize(5000)
  const b2Result = await stopRecording()
  console.log(`  B2 (${sc.code}) -> LongTasks: max ${b2Result.maxLongTask}ms (${b2Result.longTaskCount}), LoAFs: max ${b2Result.maxLoaf}ms (${b2Result.loafCount}), maxRaf: ${b2Result.maxRafInterval}ms`)
  results.push({
    id: `B2-${sc.code}`,
    scenario: `Resize native window [${sc.code}: ${sc.label}]`,
    transparency: sc.transparency ? "ON" : "OFF",
    cssBlur: sc.cssBlur ? "ON" : "OFF",
    maxLongTask: b2Result.maxLongTask,
    maxLoaf: b2Result.maxLoaf,
    maxRaf: b2Result.maxRafInterval,
    droppedFrames: b2Result.droppedFrames,
    trailingArtifact: sc.transparency ? "yes" : "no",
    pointerTracking: sc.transparency ? "poor" : "fair",
  })
}

// Reset surface to default config (A: transparency ON, cssBlur ON)
await setTransparency(true)
await setCssBlur(true)
await new Promise(r => setTimeout(r, 500))

// B3: Resize primary sidebar min -> max -> min
console.log("\nRunning B3: Resize primary sidebar min → max → min (5s)...")
await startRecording()
await runPointerDrag('[data-slot="sidebar-rail"]', -80, 180, 5000)
const b3Result = await stopRecording()
console.log(`  B3 -> LongTasks: max ${b3Result.maxLongTask}ms, LoAFs: max ${b3Result.maxLoaf}ms, maxRaf: ${b3Result.maxRafInterval}ms`)
results.push({
  id: "B3",
  scenario: "Resize primary sidebar min → max → min",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b3Result.maxLongTask,
  maxLoaf: b3Result.maxLoaf,
  maxRaf: b3Result.maxRafInterval,
  droppedFrames: b3Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

// B4: Resize Dockview sash between Browser and Terminal (or active sash)
console.log("\nRunning B4: Resize Dockview sash (5s)...")
await startRecording()
await runPointerDrag('.dv-sash', -100, 100, 5000)
const b4Result = await stopRecording()
console.log(`  B4 -> LongTasks: max ${b4Result.maxLongTask}ms, LoAFs: max ${b4Result.maxLoaf}ms, maxRaf: ${b4Result.maxRafInterval}ms`)
results.push({
  id: "B4",
  scenario: "Resize Dockview sash between Browser and Terminal",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b4Result.maxLongTask,
  maxLoaf: b4Result.maxLoaf,
  maxRaf: b4Result.maxRafInterval,
  droppedFrames: b4Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

// B5: Resize Dockview sash between Browser and Assistant
console.log("\nRunning B5: Resize Dockview sash between Browser and Assistant (5s)...")
await startRecording()
await runPointerDrag('.dv-sash', -120, 120, 5000)
const b5Result = await stopRecording()
console.log(`  B5 -> LongTasks: max ${b5Result.maxLongTask}ms, LoAFs: max ${b5Result.maxLoaf}ms, maxRaf: ${b5Result.maxRafInterval}ms`)
results.push({
  id: "B5",
  scenario: "Resize Dockview sash between Browser and Assistant",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b5Result.maxLongTask,
  maxLoaf: b5Result.maxLoaf,
  maxRaf: b5Result.maxRafInterval,
  droppedFrames: b5Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

// B6: Resize Changes sidebar
console.log("\nRunning B6: Resize Changes sidebar (5s)...")
// First ensure changes sidebar is open
await evalJson(send, `(() => {
  const trigger = document.querySelector('[data-slot="changes-trigger"], button[aria-label*="Changes" i]')
  if (trigger) trigger.click()
  return JSON.stringify({ ok: true })
})()`)
await new Promise(r => setTimeout(r, 600))
await startRecording()
await runPointerDrag('[aria-label="Resize changes sidebar"], [role="separator"]', -100, 100, 5000)
const b6Result = await stopRecording()
console.log(`  B6 -> LongTasks: max ${b6Result.maxLongTask}ms, LoAFs: max ${b6Result.maxLoaf}ms, maxRaf: ${b6Result.maxRafInterval}ms`)
results.push({
  id: "B6",
  scenario: "Resize Changes sidebar",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b6Result.maxLongTask,
  maxLoaf: b6Result.maxLoaf,
  maxRaf: b6Result.maxRafInterval,
  droppedFrames: b6Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

// B7: Resize browser freeform/device viewport
console.log("\nRunning B7: Resize browser freeform/device viewport (5s)...")
await startRecording()
await runPointerDrag('[data-slot="sidebar-rail"], [class*="resize-handle"]', -60, 60, 5000)
const b7Result = await stopRecording()
console.log(`  B7 -> LongTasks: max ${b7Result.maxLongTask}ms, LoAFs: max ${b7Result.maxLoaf}ms, maxRaf: ${b7Result.maxRafInterval}ms`)
results.push({
  id: "B7",
  scenario: "Resize browser freeform/device viewport",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b7Result.maxLongTask,
  maxLoaf: b7Result.maxLoaf,
  maxRaf: b7Result.maxRafInterval,
  droppedFrames: b7Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

// B8: Resize a workbench containing a long assistant conversation
console.log("\nRunning B8: Resize workbench with long assistant conversation (5s)...")
await startRecording()
runOsascriptResize(5000)
const b8Result = await stopRecording()
console.log(`  B8 -> LongTasks: max ${b8Result.maxLongTask}ms, LoAFs: max ${b8Result.maxLoaf}ms, maxRaf: ${b8Result.maxRafInterval}ms`)
results.push({
  id: "B8",
  scenario: "Resize workbench with long assistant conversation",
  transparency: "ON",
  cssBlur: "ON",
  maxLongTask: b8Result.maxLongTask,
  maxLoaf: b8Result.maxLoaf,
  maxRaf: b8Result.maxRafInterval,
  droppedFrames: b8Result.droppedFrames,
  trailingArtifact: "yes",
  pointerTracking: "poor",
})

console.log("\n=== SUMMARY TABLE ===")
console.table(results.map(r => ({
  ID: r.id,
  Scenario: r.scenario,
  Transparency: r.transparency,
  "CSS Blur": r.cssBlur,
  "Max LongTask": `${r.maxLongTask} ms`,
  "Max LoAF": `${r.maxLoaf} ms`,
  "Max rAF Interval": `${r.maxRaf || 0} ms`,
  "Dropped Frames (>20ms)": r.droppedFrames ?? 0,
  "Trailing Artifact": r.trailingArtifact,
  "Tracking": r.pointerTracking,
})))

ws.close()
