import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function waitForTarget(port, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited before CDP became ready (${child.exitCode})`)
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
      const target = targets.find(value => value.type === 'page')
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch {}
    await delay(250)
  }
  throw new Error('Timed out waiting for the Electron renderer')
}

function connect(url) {
  const socket = new WebSocket(url)
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  }
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  return {
    ready,
    close: () => socket.close(),
    async send(method, params = {}) {
      await ready
      const id = ++sequence
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      socket.send(JSON.stringify({ id, method, params }))
      return result
    },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Renderer evaluation failed')
  return result.result.value
}

async function navigate(cdp, destination) {
  await evaluate(cdp, `(async()=>{window.__navigationRuntimeHarness.navigate(${JSON.stringify(destination)});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return true})()`)
  return evaluate(cdp, 'window.__navigationRuntimeHarness.snapshot()')
}

function findIdentity(snapshot, project, revision = 1) {
  return Object.keys(snapshot.mounts).find(key => key.includes(`project-${project}`) && key.includes(`,${revision},`))
}

export async function runNavigationScenarios({ mode, samples, fixture, evidence }) {
  const port = 9229 + Math.floor(Math.random() * 500)
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-navigation-electron-'))
  const executable = process.platform === 'darwin'
    ? path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.resolve('node_modules/electron/dist/electron')
  const child = spawn(executable, [path.resolve('apps/desktop/out/main/index.js'), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, COZEA_NAVIGATION_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  let cdp
  try {
    cdp = connect(await waitForTarget(port, child))
    await cdp.ready
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(cdp, 'document.documentElement.dataset.navigationHarnessReady === "true"')) break
      if (attempt === 119) throw new Error('Navigation harness did not become ready')
      await delay(100)
    }

    const first = await navigate(cdp, 'a')
    const a1 = findIdentity(first, 'a', 1)
    assert(a1, 'Workbench A did not mount')
    await navigate(cdp, 'store')
    const returned = await navigate(cdp, 'a')
    assert(returned.mounts[a1] === 1 && !returned.unmounts[a1], 'A was recreated after Store navigation')

    await navigate(cdp, 'b'); await navigate(cdp, 'a')
    const two = await evaluate(cdp, 'window.__navigationRuntimeHarness.snapshot()')
    assert(two.residents.length === 2, 'A/B retention did not preserve two instances')
    const b1 = findIdentity(two, 'b', 1)
    assert(b1, 'Workbench B did not mount')
    await navigate(cdp, 'c'); const four = await navigate(cdp, 'd')
    assert(four.residents.length === 3, 'Resident cap was not enforced')
    assert(four.unmounts[b1] === 1, 'Least-recently-used workbench B was not disposed exactly once')
    assert(!four.unmounts[a1], 'Recently revisited workbench A was evicted instead of B')

    const revised = await navigate(cdp, 'a2')
    const a2 = findIdentity(revised, 'a', 2)
    assert(a2 && revised.mounts[a2] === 1, 'Revised workspace binding did not get a fresh instance')

    const timings = []
    if (mode === 'performance') {
      for (let index = 0; index < samples; index++) {
        const duration = await evaluate(cdp, `(async()=>{window.__navigationRuntimeHarness.navigate('store');await new Promise(requestAnimationFrame);const start=performance.now();window.__navigationRuntimeHarness.navigate('a2');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return performance.now()-start})()`)
        timings.push(duration)
      }
      timings.sort((a, b) => a - b)
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1]
      assert(p95 <= 75, `Resident-warm navigation p95 ${p95.toFixed(2)}ms exceeds 75ms`)
    }

    const report = { mode, fixture, samples: timings.length, residentWarmP95Ms: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null, assertions: 'passed' }
    const output = path.resolve(evidence ?? `build/navigation-validation/electron-${mode}.json`)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } catch (error) {
    console.error(logs.slice(-12000))
    throw error
  } finally {
    cdp?.close()
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
    if (child.exitCode === null) child.kill('SIGKILL')
    await fs.rm(profile, { recursive: true, force: true })
  }
}
