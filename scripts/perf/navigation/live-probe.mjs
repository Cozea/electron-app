#!/usr/bin/env node
/**
 * Measures page navigation in a running Cozea renderer — real routes, real
 * pages, real data — over the Chrome DevTools Protocol. The Electron harness in
 * this folder proves workbench retention against placeholder pages; this probe
 * answers "how long until the page I clicked is on screen, and does it survive
 * the round trip".
 *
 * Start the app with a debugging port, open any project workbench, then run:
 *
 *   ELECTRON_REMOTE_DEBUGGING_PORT=9333 bun run dev
 *   bun run perf:navigation:live -- --port 9333 --samples 5 --out build/navigation-live.json
 *
 * Pass --project <id> when the app is not currently on a project workbench.
 *
 * It only navigates and reads DOM/performance state; it never edits data.
 * Development builds require `window.__appRouter` (exposed in DEV only).
 *
 * Per page it reports, as medians over the samples:
 *   fromWorkbench  navigate from the project workbench to the page
 *   fromPage       navigate from another page to the page
 * each split into `commit` (router resolved) and `settled` (no DOM mutations
 * for 250 ms), plus whether a loading skeleton appeared, and on return whether
 * the page instance and its scroll position survived.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '9333' },
    samples: { type: 'string', default: '5' },
    out: { type: 'string' },
    project: { type: 'string' },
  },
})
const port = Number(values.port)
const samples = Number(values.samples)

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const target = targets.find((entry) => entry.type === 'page' && !entry.url.startsWith('devtools://'))
if (!target) throw new Error(`No renderer page on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

await evaluate(`(() => {
  if (!window.__appRouter) throw new Error('window.__appRouter is missing: run a development build')
  // Pages render beside the persistent workbench surface, inside its parent.
  const pageElement = () => {
    const surface = document.querySelector('[data-workbench-persistent-surface]')
    const content = surface?.parentElement
    if (!content) return null
    // Retained pages each sit in a frame; only the visible one is on screen.
    const visible = content.querySelector(':scope > [data-retained-page="visible"]')
    if (visible) return visible
    return [...content.children].find((element) =>
      element !== surface && !element.matches('[role=status]') &&
      !element.matches('[data-retained-page]')) ?? null
  }
  const scroller = (page) => {
    if (!page) return null
    const candidates = [page.parentElement, page, ...page.querySelectorAll('*')].filter((element) => element &&
      element.scrollHeight > element.clientHeight + 40 &&
      /(auto|scroll)/.test(getComputedStyle(element).overflowY))
    return candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? null
  }
  window.__navigationLiveProbe = {
    path: () => window.__appRouter.state.location.pathname,
    async go(to) {
      const start = performance.now()
      let lastMutation = start
      let sawSkeleton = false
      const observer = new MutationObserver(() => { lastMutation = performance.now() })
      observer.observe(document.querySelector('[data-project-layout-shell="true"]') ?? document.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'aria-busy', 'data-state'],
      })
      await window.__appRouter.navigate({ to })
      const commit = performance.now() - start
      const deadline = start + 8000
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame)
        if (pageElement()?.querySelector('[aria-busy="true"]')) sawSkeleton = true
        if (performance.now() - lastMutation >= 250) break
      }
      observer.disconnect()
      return {
        commit: +commit.toFixed(1),
        settled: +Math.max(commit, lastMutation - start).toFixed(1),
        sawSkeleton,
        timedOut: performance.now() >= deadline,
      }
    },
    mark() {
      const page = pageElement()
      if (!page) return null
      page.dataset.navigationLiveProbe = 'kept'
      const element = scroller(page)
      if (element) element.scrollTop = 250
      return element ? element.scrollTop : null
    },
    check() {
      const page = pageElement()
      return {
        instanceKept: page?.dataset.navigationLiveProbe === 'kept',
        scrollTop: scroller(page)?.scrollTop ?? null,
      }
    },
  }
  return true
})()`)

const startPath = await evaluate('window.__navigationLiveProbe.path()')
const projectId = values.project ?? startPath.match(/\/projects\/p\/([^/]+)/)?.[1]
if (!projectId) throw new Error(`Open a project workbench or pass --project (at ${startPath})`)
const workbench = `/projects/p/${projectId}/workbench`
const neutralPage = '/projects/settings/appearance'
const pages = [
  ['projects', '/projects'],
  ['store', '/projects/store'],
  ['skills', '/projects/skills'],
  ['inbox', '/projects/inbox'],
  ['tasks', `/projects/p/${projectId}/tasks`],
  ['team', `/projects/p/${projectId}/team`],
  ['settings-account', '/projects/settings/account'],
  ['settings-tooling', '/projects/settings/tooling'],
]

const go = (to) => evaluate(`window.__navigationLiveProbe.go(${JSON.stringify(to)})`)
const median = (list, key) => {
  const sorted = list.map((entry) => entry[key]).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const report = { projectId, samples, pages: {} }
for (const [name, to] of pages) {
  // Warm the module and first render so both series measure revisits.
  await go(to)
  const fromWorkbench = []
  const fromPage = []
  for (let index = 0; index < samples; index++) {
    await go(workbench)
    fromWorkbench.push(await go(to))
    await go(to === neutralPage ? '/projects/store' : neutralPage)
    fromPage.push(await go(to))
  }
  const scrolledTo = await evaluate('window.__navigationLiveProbe.mark()')
  await go(workbench)
  await go(to)
  const retention = { scrolledTo, ...(await evaluate('window.__navigationLiveProbe.check()')) }
  report.pages[name] = { to, fromWorkbench, fromPage, retention }
  console.log(
    `${name.padEnd(18)} from workbench ${String(median(fromWorkbench, 'commit')).padStart(6)} ms` +
      ` (settled ${String(median(fromWorkbench, 'settled')).padStart(6)})` +
      ` | from page ${String(median(fromPage, 'commit')).padStart(6)} ms` +
      ` (settled ${String(median(fromPage, 'settled')).padStart(6)})` +
      ` | skeleton ${[...fromWorkbench, ...fromPage].some((entry) => entry.sawSkeleton) ? 'yes' : 'no '}` +
      ` | kept ${retention.instanceKept ? 'yes' : 'no '} scroll ${retention.scrolledTo ?? '-'}→${retention.scrollTop ?? '-'}`,
  )
}
await go(startPath)
socket.close()

if (values.out) {
  const output = path.resolve(values.out)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
}
