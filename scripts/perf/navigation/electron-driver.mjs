import { execFileSync, spawn } from 'node:child_process'
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
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description
    throw new Error(description ?? result.exceptionDetails.text ?? 'Renderer evaluation failed')
  }
  return result.result.value
}

async function waitForProductionRuntime(cdp, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited before the harness became ready (${child.exitCode})`)
    try {
      if (await evaluate(cdp, 'document.documentElement?.dataset.navigationProductionReady === "true"')) return
    } catch {
      // The first page target can exist while its initial document is still being replaced.
      // Treat transient evaluation/context errors as not-ready and keep polling.
    }
    await delay(100)
  }
  throw new Error('Production navigation runtime did not become ready')
}

async function navigate(cdp, destination) {
  await evaluate(cdp, `(async()=>{await window.__navigationProductionRuntime.navigate(${JSON.stringify(destination)});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return true})()`)
  return evaluate(cdp, 'window.__navigationProductionRuntime.snapshot()')
}

async function waitForSnapshot(cdp, predicate, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const snapshot = await evaluate(cdp, 'window.__navigationProductionRuntime.snapshot()')
    if (predicate(snapshot)) return snapshot
    await delay(100)
  }
  throw new Error(message)
}

async function createGitFixture(root, name) {
  const folder = path.join(root, name)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'README.md'), `# ${name}\n`)
  execFileSync('git', ['init', '-b', 'main'], { cwd: folder, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'navigation-test@cozea.invalid'], { cwd: folder })
  execFileSync('git', ['config', 'user.name', 'Navigation Test'], { cwd: folder })
  execFileSync('git', ['add', 'README.md'], { cwd: folder })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: folder, stdio: 'ignore' })
  return folder
}

async function attachProject(cdp, projectId, folderPath) {
  return evaluate(cdp, `window.__navigationProductionRuntime.attachProject(${JSON.stringify(projectId)},${JSON.stringify(folderPath)})`)
}

export async function runNavigationScenarios({ mode, samples, fixture, evidence }) {
  const port = 9229 + Math.floor(Math.random() * 500)
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-navigation-electron-'))
  const workspaces = path.join(profile, 'fixture-workspaces')
  const executable = process.platform === 'darwin'
    ? path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.resolve('node_modules/electron/dist/electron')
  const electronArgs = [
    path.resolve('apps/desktop/out/main/index.js'),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
  ]
  if (process.platform !== 'darwin' && !process.env.DISPLAY) electronArgs.push('--headless', '--disable-gpu')
  const child = spawn(executable, electronArgs, {
    env: { ...process.env, COZEA_NAVIGATION_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  let cdp
  try {
    cdp = connect(await waitForTarget(port, child))
    await cdp.ready
    await waitForProductionRuntime(cdp, child)

    const folders = Object.fromEntries(await Promise.all(
      ['a', 'b', 'c', 'd'].map(async name => [name, await createGitFixture(workspaces, name)]),
    ))
    const attached = {}
    for (const name of ['a', 'b', 'c', 'd']) {
      attached[name] = await attachProject(cdp, `project-${name}`, folders[name])
    }

    await navigate(cdp, 'a')
    const first = await waitForSnapshot(
      cdp,
      value => value.surfaceVisible === 'true' && value.sessionKey && value.dockviewCount === 1,
      'Production workbench A did not become ready',
    )
    const a1 = first.sessionKey
    assert(a1.endsWith(`::v${attached.a.workspaceRevision}`), 'Workbench A session omitted its binding revision')
    await evaluate(cdp, `(()=>{
      const shell=document.querySelector('[data-project-layout-shell="true"]');
      const surface=document.querySelector('[data-workbench-persistent-surface="true"]');
      const dock=document.querySelector('.cozea-workbench-dockview-host');
      if(!shell||!surface||!dock) return false;
      shell.dataset.navigationSentinel='shell';
      surface.dataset.navigationSentinel='surface';
      dock.dataset.navigationSentinel='a1';
      return true;
    })()`)

    const store = await navigate(cdp, 'store')
    assert(store.destination === '/projects/store' && store.ordinarySurface === 'store', 'Store route was not actually displayed')
    assert(store.surfaceVisible === 'false', 'Persistent workbench surface was not hidden on Store')
    assert(await evaluate(cdp, `Boolean(
      document.querySelector('[data-project-layout-shell="true"][data-navigation-sentinel="shell"]') &&
      document.querySelector('[data-workbench-persistent-surface="true"][data-navigation-sentinel="surface"]') &&
      document.querySelector('.cozea-workbench-dockview-host[data-navigation-sentinel="a1"]')
    )`), 'Production shell or Dockview was recreated on Store navigation')

    await navigate(cdp, 'a')
    const returned = await waitForSnapshot(
      cdp,
      value => value.surfaceVisible === 'true' && value.sessionKey === a1,
      'Workbench A did not return with the original session',
    )
    assert(returned.residentCount === 1, 'Workbench A return changed the resident set')
    assert(await evaluate(cdp, `Boolean(document.querySelector('.cozea-workbench-dockview-host[data-navigation-sentinel="a1"]'))`), 'Dockview A was recreated after Store navigation')

    await navigate(cdp, 'b'); await navigate(cdp, 'a')
    const two = await waitForSnapshot(cdp, value => value.residentCount === 2, 'A/B retention did not preserve two instances')
    assert(two.sessionKey === a1, 'Returning to A selected a different main-process session')
    await navigate(cdp, 'c'); await navigate(cdp, 'd')
    const four = await waitForSnapshot(cdp, value => value.residentCount === 3, 'Resident cap was not enforced')
    assert(four.dockviewCount === 3, 'Resident cap did not apply to real Dockview instances')
    assert(await evaluate(cdp, `Boolean(document.querySelector('.cozea-workbench-dockview-host[data-navigation-sentinel="a1"]'))`), 'Recently revisited Dockview A was evicted')

    await navigate(cdp, 'store')
    const reboundFolder = `${folders.a}-rebound`
    await fs.rename(folders.a, reboundFolder)
    const rebound = await evaluate(cdp, `window.__navigationProductionRuntime.reattachProject(
      'project-a',
      ${JSON.stringify(attached.a.workspaceId)},
      ${JSON.stringify(reboundFolder)}
    )`)
    assert(rebound.workspaceId === attached.a.workspaceId, 'Revision fixture changed workspace identity')
    assert(rebound.workspaceRevision > attached.a.workspaceRevision, 'Revision fixture did not advance the binding revision')
    await navigate(cdp, 'a')
    const revised = await waitForSnapshot(
      cdp,
      value => value.surfaceVisible === 'true' && value.sessionKey?.endsWith(`::v${rebound.workspaceRevision}`),
      'Revised workspace binding did not activate a revision-scoped session',
    )
    assert(revised.sessionKey !== a1, 'Revised binding reused the prior main-process session key')
    assert(!revised.sessions.some(session => session.sessionKey === a1), 'Superseded binding retained old runtime resources')
    assert(!await evaluate(cdp, `Boolean(document.querySelector('.cozea-workbench-dockview-host[data-navigation-sentinel="a1"]'))`), 'Superseded Dockview instance survived binding invalidation')

    const timings = []
    if (mode === 'performance') {
      for (let index = 0; index < samples; index++) {
        const duration = await evaluate(cdp, `(async()=>{
          await window.__navigationProductionRuntime.navigate('store');
          await new Promise(requestAnimationFrame);
          const start=performance.now();
          await window.__navigationProductionRuntime.navigate('a');
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return performance.now()-start;
        })()`)
        timings.push(duration)
      }
      timings.sort((a, b) => a - b)
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1]
      assert(p95 <= 75, `Resident-warm navigation p95 ${p95.toFixed(2)}ms exceeds 75ms`)
    }

    const report = {
      mode,
      fixture,
      productionPath: true,
      samples: timings.length,
      residentWarmP95Ms: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null,
      assertions: 'passed',
    }
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
