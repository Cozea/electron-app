// Run with Electron via scripts/acceptance-native-browser-automation.mjs.
//
// PH3-C plus the explicit-close, session-eviction and renderer-reload gates,
// driven through the real T3BrowserSurfaceService: the real T3 preview manager,
// its Effect runtime and its Playwright locators, operating a real main-owned
// WebContentsView.
//
// Every automation operation is verified through the *visible* contents directly
// -- webContents.fromId(the id the native host created) -- never through T3's own
// report of what it did. An operation that landed in some other contents would
// therefore fail here even if T3 believed it succeeded.
//
// Pointer and keyboard checks dispatch real input through CDP, so they need the
// harness window unoccluded. Run it with the window visible on the current
// Space; the "page visibility and animation frames" row records what the page
// saw, so an environment effect can be told apart from a defect.
const { app, BrowserWindow, WebContentsView, webContents } = require('electron')

process.on('uncaughtException', (error) => {
  console.error('[acceptance] uncaught exception:', error)
  app.exit(1)
})
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')

const bundlePath = process.env.COZEA_T3_SERVICE_BUNDLE
assert.ok(bundlePath, 'COZEA_T3_SERVICE_BUNDLE must point at the bundled service')

const PAGE = `<!doctype html><meta charset="utf-8"><title>Automation Probe</title>
<body style="margin:0;background:rgb(0,170,85)">
<button id="go" onclick="document.getElementById('out').textContent='clicked'">Go</button>
<p id="out">idle</p>
<input id="name" aria-label="Name">
<p id="pressed">none</p>
<a id="next" href="/second">Next</a>
<div style="height:4000px"></div>
<script>
  document.getElementById('name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('pressed').textContent = 'enter'
  })
</script>`
const SECOND = '<!doctype html><meta charset="utf-8"><title>Second Page</title><h1>second</h1>'

// Served over http://127.0.0.1 because getDisplayMedia needs a secure context.
// Frames are read with MediaStreamTrackProcessor rather than a <video>, so
// counting them does not depend on the host page itself being painted.
const HOST = `<!doctype html><meta charset="utf-8"><title>Acceptance host</title>
<body style="margin:0;background:rgb(170,0,85)">
<script>
  const initial = () => ({ state: 'idle', frames: 0, width: 0, height: 0, sample: null, error: null })
  window.__recording = initial()
  window.__resetRecording = () => { window.__recording = initial() }
  globalThis.__t3DesktopPreviewRecordingCapture = () => {
    const recording = window.__recording
    recording.state = 'requested'
    navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { max: 30 } } })
      .then(async (stream) => {
        window.__recordingStream = stream
        recording.state = 'streaming'
        const [track] = stream.getVideoTracks()
        track.addEventListener('ended', () => { if (recording.state === 'streaming') recording.state = 'ended' })
        const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
        for (;;) {
          const { value: frame, done } = await reader.read()
          if (done) break
          recording.frames += 1
          if (!recording.sample) {
            recording.width = frame.displayWidth
            recording.height = frame.displayHeight
            const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
            const context = canvas.getContext('2d')
            context.drawImage(frame, 0, 0)
            const x = Math.floor(frame.displayWidth / 2)
            const y = Math.floor(frame.displayHeight / 2)
            recording.sample = Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
          }
          frame.close()
        }
        if (recording.state === 'streaming') recording.state = 'ended'
      })
      .catch((error) => { recording.state = 'failed'; recording.error = String(error) })
    return true
  }
  window.__stopRecordingStream = () => {
    for (const track of window.__recordingStream?.getTracks() ?? []) track.stop()
    window.__recordingStream = null
  }
</script>`

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ])

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`)
}

async function check(name, fn, timeoutMs = 20_000) {
  const started = Date.now()
  try {
    const detail = await withTimeout(Promise.resolve().then(fn), timeoutMs, name)
    results.push({ name, status: 'PASS', ms: Date.now() - started, detail: detail ?? '' })
  } catch (error) {
    results.push({
      name,
      status: 'FAIL',
      ms: Date.now() - started,
      detail: String(error && (error.message || error)).slice(0, 400),
    })
  }
}

function manual(name, reason) {
  results.push({ name, status: 'MANUAL', ms: 0, detail: reason })
}

// automationEvaluate may return the raw value or an envelope around it.
const unwrap = (result) =>
  result && typeof result === 'object' && 'value' in result ? result.value : result

const timeout = setTimeout(() => {
  console.error('Native browser automation acceptance timed out')
  report()
  app.exit(1)
}, 180_000)

function report() {
  const width = Math.max(...results.map((row) => row.name.length))
  console.log('\n=== Native browser automation acceptance ===')
  for (const row of results) {
    console.log(`${row.status.padEnd(6)} ${row.name.padEnd(width)}  ${String(row.ms).padStart(5)}ms  ${row.detail}`)
  }
  const failed = results.filter((row) => row.status === 'FAIL').length
  const passed = results.filter((row) => row.status === 'PASS').length
  const manualCount = results.filter((row) => row.status === 'MANUAL').length
  console.log(`\n${passed} passed, ${failed} failed, ${manualCount} manual`)
  return failed
}

app.whenReady().then(async () => {
  let T3BrowserSurfaceService
  try {
    ;({ T3BrowserSurfaceService } = require(bundlePath))
  } catch (error) {
    console.error('[acceptance] could not load the bundled service:', error && error.message)
    report()
    app.exit(1)
    return
  }

  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(request.url === '/second' ? SECOND : request.url === '/host' ? HOST : PAGE)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const window = new BrowserWindow({ width: 1000, height: 760, show: false })
  // Shown so native views have a real window to composite into, but never
  // focused: an acceptance run should not steal the developer's keyboard.
  window.showInactive()
  await window.loadURL(`${base}/host`)

  const unsubscribe = () => () => undefined
  const service = new T3BrowserSurfaceService({
    getMainWindow: () => window,
    // Browser-kind surfaces never reach the DevApp services; these are the
    // constructor's structural requirements only.
    orgDevAppArtifactService: { registerProtocolForSession() {} },
    devAppPreviewService: { registerProtocolForSession() {}, onWorkerStateChange: unsubscribe },
    publishedDevAppRuntimeService: { onWorkerStateChange: unsubscribe, workerConnection: () => null },
    artifactsDirectory: process.env.COZEA_ACCEPTANCE_ARTIFACTS,
    pickPreloadPath: process.env.COZEA_PICK_PRELOAD || '',
    devAppPickPreloadPath: '',
    pictureInPicturePreloadPath: process.env.COZEA_PIP_PRELOAD || '',
  })
  // Production calls this once the main window exists; mirror that order.
  await service.setMainWindow(window)

  const descriptor = (runtimeTabId, sessionKey, workspaceId, initialUrl = `${base}/`) => ({
    runtimeTabId,
    tileId: `tile-${runtimeTabId}`,
    workbenchSessionKey: sessionKey,
    kind: 'browser',
    title: runtimeTabId,
    initialUrl,
    storageScope: 'ephemeral',
    workspaceId,
    laneId: 'collab',
    runtimeGeneration: null,
  })

  async function openSurface(runtimeTabId, sessionKey, workspaceId) {
    await service.prepareSurface(descriptor(runtimeTabId, sessionKey, workspaceId))
    await service.ensureNativeSurface(runtimeTabId)
    service.layoutNativeSurface(runtimeTabId, {
      windowId: 0, x: 0, y: 0, width: 900, height: 640, cornerRadius: 0, nativeOrder: 0,
    })
    service.setNativeSurfaceVisible(runtimeTabId, true)
    const view = service.listNativeSurfaces().find((surface) => surface.runtimeTabId === runtimeTabId)
    assert.ok(view, `a native view must exist for ${runtimeTabId}`)
    return view.webContentsId
  }

  const nativeIds = () => service.listNativeSurfaces().map((surface) => surface.webContentsId)
  const inventoryIds = () => service.listSurfaces().map((entry) => entry.runtimeTabId)
  const isGone = (id) => {
    const contents = webContents.fromId(id)
    return !contents || contents.isDestroyed()
  }

  // ---------------------------------------------------------------- PH3-C ----
  const TAB = 'rt_automation'
  const SESSION = 'proj::collab::ws_auto::v1'
  let visibleId = null
  let visible = null

  await check('native surface opens and loads through the service', async () => {
    visibleId = await openSurface(TAB, SESSION, 'ws_auto')
    visible = webContents.fromId(visibleId)
    await waitFor(() => visible.getTitle() === 'Automation Probe', 'probe page to load')
    return `webContentsId=${visibleId}`
  })

  const probe = (expression) => visible.executeJavaScript(expression)

  await check('exactly one native view exists for the tab', () => {
    assert.equal(service.listNativeSurfaces().length, 1)
  })

  await check('T3 tab state is bound to the visible webContentsId', () => {
    const state = service.getSurfaceState(TAB)
    assert.equal(state.webContentsId, visibleId)
    return `t3=${state.webContentsId} native=${visibleId}`
  })

  await check('automationStatus describes the visible browser', async () => {
    const status = await service.automationStatus(TAB)
    assert.equal(status.available, true)
    assert.equal(status.title, visible.getTitle())
    assert.equal(status.url, visible.getURL())
    return `title="${status.title}"`
  })

  await check('evaluate reads the visible page', async () => {
    const value = unwrap(await service.automationEvaluate(TAB, { expression: 'document.title' }))
    assert.equal(value, visible.getTitle())
  })

  await check('evaluate writes into the visible page', async () => {
    // The decisive same-contents proof: T3 writes, the visible contents reads.
    await service.automationEvaluate(TAB, { expression: 'window.__t3mark = "set-by-t3"; "ok"' })
    assert.equal(await probe('window.__t3mark'), 'set-by-t3')
  })

  // Observation, not an assertion: pointer and keyboard automation wait on the
  // page being visible and producing animation frames, and a harness window that
  // is occluded (another Space, a full-screen app) stops both. Recording what the
  // page saw at this moment separates an environment effect from a real defect.
  await check('page visibility and animation frames at automation time', async () => {
    const page = await probe(`new Promise((resolve) => {
      let rafFired = false
      requestAnimationFrame(() => { rafFired = true })
      setTimeout(() => resolve({
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
        rafFired,
      }), 500)
    })`)
    return JSON.stringify({ ...page, windowVisible: window.isVisible(), windowFocused: window.isFocused() })
  })

  await check('click lands in the visible page', async () => {
    await service.automationClick(TAB, { selector: '#go' })
    await waitFor(async () => (await probe('document.getElementById("out").textContent')) === 'clicked', 'click effect')
  })

  await check('type lands in the visible page', async () => {
    await service.automationType(TAB, { selector: '#name', text: 'typed by t3', clear: true })
    assert.equal(await probe('document.getElementById("name").value'), 'typed by t3')
  })

  await check('press lands in the visible page', async () => {
    await service.automationPress(TAB, { key: 'Enter' })
    await waitFor(async () => (await probe('document.getElementById("pressed").textContent')) === 'enter', 'press effect')
  })

  await check('scroll moves the visible page', async () => {
    await service.automationScroll(TAB, { deltaY: 800 })
    await waitFor(async () => (await probe('window.scrollY')) > 0, 'scroll effect')
    return `scrollY=${await probe('window.scrollY')}`
  })

  await check('waitFor observes the visible page', async () => {
    await service.automationWaitFor(TAB, { text: 'clicked' })
  })

  await check('controller state is reported for the tab', () => {
    const state = service.getSurfaceState(TAB)
    assert.ok('controller' in state, 'surface state must carry a controller')
    return `controller=${JSON.stringify(state.controller)}`
  })

  await check('snapshot describes the visible page', async () => {
    const snapshot = await service.automationSnapshot(TAB)
    assert.equal(snapshot.title, visible.getTitle())
    assert.equal(snapshot.url, visible.getURL())
    assert.ok(snapshot.interactiveElements.length > 0, 'snapshot must list interactive elements')
    assert.ok(snapshot.screenshot.width > 0, 'snapshot must include a screenshot')
    return `elements=${snapshot.interactiveElements.length} shot=${snapshot.screenshot.width}x${snapshot.screenshot.height}`
  }, 30_000)

  await check('screenshot capture produces an artifact', async () => {
    const artifact = await service.captureScreenshot(TAB)
    const artifactPath = artifact.path ?? artifact.filePath
    assert.ok(artifactPath && fs.existsSync(artifactPath), `artifact file must exist (keys: ${Object.keys(artifact)})`)
    return artifactPath.split('/').pop()
  }, 30_000)

  // Recording drives the real pipeline: main asks the host renderer to request
  // display media, and the grant must name the exact native contents.
  const onHost = (expression, userGesture = false) =>
    window.webContents.executeJavaScript(expression, userGesture)
  const recordingState = () => onHost('JSON.parse(JSON.stringify(window.__recording))')
  // A fresh request with a user gesture, so a refusal can only mean no grant is
  // armed -- not a missing activation.
  const probeGrant = () =>
    onHost(
      "navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })" +
        ".then((stream) => { stream.getTracks().forEach((track) => track.stop()); return 'granted' }," +
        " (error) => 'refused:' + error.name)",
      true,
    )

  await check('recording streams the exact native contents to the Cozea renderer', async () => {
    const contentsBefore = webContents.getAllWebContents().length
    await onHost('window.__resetRecording()')
    await service.startRecording(TAB)
    await waitFor(async () => (await recordingState()).frames >= 1, 'recorded frames to arrive', 15_000)
    // A static page may yield one frame and stop. A recording needs the stream
    // to keep delivering, so change something visible at any scroll position
    // -- and away from the sampled centre pixel -- and require more frames.
    await probe(`document.body.insertAdjacentHTML('beforeend',
      '<div id="tick" style="position:fixed;left:8px;top:8px;font:14px sans-serif">0</div>')`)
    for (let tick = 1; tick <= 8; tick += 1) {
      await probe(`document.getElementById('tick').textContent = '${tick}'`)
      await sleep(120)
    }
    await waitFor(async () => (await recordingState()).frames >= 3, 'the stream to keep delivering frames', 10_000)
    const state = await recordingState()
    assert.equal(state.state, 'streaming', `stream state (${state.error ?? 'no error'})`)
    assert.ok(state.sample, 'a recorded frame must have been sampled')
    // The probe page is rgb(0,170,85) and the host renderer is rgb(170,0,85): a
    // frame from anything but the native tab fails here.
    const [r, g, b] = state.sample
    assert.ok(r < 60 && g > 120 && Math.abs(b - 85) < 50, `recorded pixel ${state.sample} must come from the native tab`)
    assert.deepEqual(nativeIds(), [visibleId], 'recording must not create a second browser')
    assert.equal(webContents.getAllWebContents().length, contentsBefore, 'recording must not add a hidden browser')
    return `frames=${state.frames} size=${state.width}x${state.height} pixel=${state.sample.join(',')}`
  }, 40_000)

  await check('stopping a recording tears down the stream and leaves no grant', async () => {
    await service.stopRecording(TAB)
    await onHost('window.__stopRecordingStream()')
    const afterStop = await probeGrant()
    assert.match(afterStop, /^refused/, 'no display-media grant may survive a stopped recording')
    // The arm slot and capture consumer are free again: a new recording starts.
    await onHost('window.__resetRecording()')
    await service.startRecording(TAB)
    await waitFor(async () => (await recordingState()).frames >= 1, 'a restarted recording to stream', 15_000)
    await service.stopRecording(TAB)
    await onHost('window.__stopRecordingStream()')
    return `after stop: ${afterStop}; restart streamed`
  }, 40_000)

  await check('closing a tab mid-recording leaves no grant or capture behind', async () => {
    const closingId = await openSurface('rt_recording_close', SESSION, 'ws_auto')
    await waitFor(() => webContents.fromId(closingId).getTitle() === 'Automation Probe', 'second tab to load')
    await onHost('window.__resetRecording()')
    await service.startRecording('rt_recording_close')
    await waitFor(async () => (await recordingState()).frames >= 1, 'frames from the tab being closed', 15_000)
    await service.releaseSurface('rt_recording_close')
    await waitFor(() => isGone(closingId), 'the recorded tab to be destroyed', 5_000)
    await sleep(300)
    const trackState = (await recordingState()).state
    await onHost('window.__stopRecordingStream()')
    const afterClose = await probeGrant()
    assert.match(afterClose, /^refused/, 'no display-media grant may survive closing the recorded tab')
    assert.deepEqual(nativeIds(), [visibleId], 'only the original tab may remain')
    return `track=${trackState}; after close: ${afterClose}`
  }, 40_000)

  // Picture-in-picture shares the frame-capture path with recording but not the
  // webview-embedder requirement that breaks recording on native surfaces, so it
  // is checked on its own rather than assumed either way.
  await check('picture-in-picture opens and closes without replacing the browser', async () => {
    const windowsBefore = BrowserWindow.getAllWindows().length
    const contentsBefore = webContents.getAllWebContents().length
    await service.openPictureInPicture(TAB)
    await waitFor(
      () =>
        BrowserWindow.getAllWindows().length > windowsBefore ||
        webContents.getAllWebContents().length > contentsBefore,
      'a picture-in-picture window to appear',
      10_000,
    )
    const windowsOpen = BrowserWindow.getAllWindows().length
    const contentsOpen = webContents.getAllWebContents().length
    assert.deepEqual(nativeIds(), [visibleId], 'PiP must not create a second browser')
    const status = await service.automationStatus(TAB)
    assert.equal(status.available, true, 'the browser must stay automatable while in PiP')
    await service.closePictureInPicture(TAB)
    await waitFor(
      () =>
        BrowserWindow.getAllWindows().length === windowsBefore &&
        webContents.getAllWebContents().length === contentsBefore,
      'picture-in-picture to close back to baseline',
      10_000,
    )
    return `windows ${windowsBefore}->${windowsOpen}->${windowsBefore}, contents ${contentsBefore}->${contentsOpen}->${contentsBefore}`
  }, 30_000)

  await check('picker opens and cancels on the native tab', async () => {
    const picking = service.pickElement(TAB)
    await sleep(500)
    await service.cancelPickElement(TAB)
    const outcome = await withTimeout(picking, 5_000, 'picker to settle after cancel')
    return `settled with ${outcome === null ? 'null' : typeof outcome}`
  })

  await check('navigate drives the visible browser without replacing it', async () => {
    await service.navigate(TAB, `${base}/second`)
    await waitFor(() => visible.getTitle() === 'Second Page', 'second page')
    assert.deepEqual(nativeIds(), [visibleId], 'navigation must not create a second browser')
  })

  await check('back and forward drive the visible browser', async () => {
    await service.goBack(TAB)
    await waitFor(() => visible.getTitle() === 'Automation Probe', 'back')
    await service.goForward(TAB)
    await waitFor(() => visible.getTitle() === 'Second Page', 'forward')
    assert.deepEqual(nativeIds(), [visibleId])
  })

  await check('refresh reloads the same browser', async () => {
    await service.refresh(TAB)
    await waitFor(() => !visible.isLoading() && visible.getTitle() === 'Second Page', 'refresh')
    assert.deepEqual(nativeIds(), [visibleId])
  })

  // Trust, isolated from the confound: after a close, registration fails at the
  // tab-closed check before trust is ever consulted. So the trust gate is proven
  // on a live tab with a live but never-vouched WebContents, where only the
  // trust check can refuse it.
  const stranger = new WebContentsView()
  window.contentView.addChildView(stranger)
  stranger.setBounds({ x: 0, y: 0, width: 10, height: 10 })
  await stranger.webContents.loadURL(`${base}/`)

  await check('an untrusted live WebContents cannot be registered to the tab', async () => {
    let refusal = null
    try {
      await service.run((manager) => manager.registerBrowserContents(TAB, stranger.webContents.id))
    } catch (error) {
      refusal = error
    }
    assert.ok(refusal, 'registering never-vouched contents must be refused')
    const text = `${refusal && refusal.message} ${JSON.stringify(refusal)}`
    assert.match(text, /WebContentsNotFound/)
    assert.equal(service.getSurfaceState(TAB).webContentsId, visibleId, 'the tab must still point at the visible browser')
    return 'refused with PreviewWebContentsNotFoundError'
  })

  await check('T3 still operates the visible browser after the refused hijack', async () => {
    const value = unwrap(await service.automationEvaluate(TAB, { expression: 'document.title' }))
    assert.equal(value, visible.getTitle())
  })

  manual('picker element selection and annotation submission',
    'the picker path opens and cancels on the native tab above; choosing an element and submitting an annotation need a real pointer gesture over the page')
  manual('find-in-page',
    'a WebContentsView in a harness reports visibilityState hidden and never runs requestAnimationFrame, so a search result is timing-dependent here')

  // ------------------------------------------------- Gate: explicit close ----
  await check('explicit close removes native, logical, inventory and contents together', async () => {
    const closedId = visibleId
    await service.releaseSurface(TAB)
    assert.equal(service.listNativeSurfaces().some((surface) => surface.runtimeTabId === TAB), false, 'native view')
    assert.equal(inventoryIds().includes(TAB), false, 'inventory entry')
    assert.equal(service.getSurfaceState(TAB), null, 'T3 surface state')
    await waitFor(() => isGone(closedId), 'closed contents to be destroyed', 5_000)
    let status = null
    try {
      status = await service.automationStatus(TAB)
    } catch {
      status = { available: false }
    }
    assert.equal(status.available, false, 'automation must report the tab unavailable')
    return `webContentsId ${closedId} destroyed`
  })

  // ---------------------------------------- Gate: session freeze / close ----
  await check('session eviction closes exactly that session\'s surfaces', async () => {
    const A = 'proj::collab::ws_a::v1'
    const B = 'proj::collab::ws_b::v1'
    const a1 = await openSurface('rt_a1', A, 'ws_a')
    const a2 = await openSurface('rt_a2', A, 'ws_a')
    const b1 = await openSurface('rt_b1', B, 'ws_b')
    // The production freeze/close path: WorkbenchSessionManager calls this.
    await service.releaseSurfacesForWorkbenchSession(A)
    assert.deepEqual(inventoryIds().sort(), ['rt_b1'], 'only the other session may remain in inventory')
    assert.deepEqual(nativeIds(), [b1], 'only the other session may keep a native view')
    await waitFor(() => isGone(a1) && isGone(a2), 'evicted session contents to be destroyed', 5_000)
    const status = await service.automationStatus('rt_b1')
    assert.equal(status.available, true, 'the surviving session must stay automatable')
    return `evicted ${a1},${a2}; kept ${b1}`
  })

  // --------------------------------------------- Gate: renderer reload ----
  await check('a renderer reload leaves no physical or logical survivor', async () => {
    const before = nativeIds()
    const c1 = await openSurface('rt_c1', 'proj::collab::ws_b::v1', 'ws_b')
    const survivors = [...before, c1]
    // A cross-document navigation of the main window is what a reload is to main.
    await window.webContents.loadURL('data:text/html,<title>Reloaded host</title>')
    await waitFor(() => nativeIds().length === 0 && inventoryIds().length === 0, 'renderer invalidation cleanup', 10_000)
    await waitFor(() => survivors.every(isGone), 'pre-reload contents to be destroyed', 5_000)
    return `closed ${survivors.join(',')}`
  })

  await check('the reloaded renderer gets only its own replacement identity', async () => {
    const replacement = await openSurface('rt_replacement', 'proj::collab::ws_b::v1', 'ws_b')
    assert.deepEqual(inventoryIds(), ['rt_replacement'])
    assert.deepEqual(nativeIds(), [replacement])
    const status = await service.automationStatus('rt_replacement')
    assert.equal(status.available, true)
    return `webContentsId=${replacement}`
  })

  const failed = report()
  clearTimeout(timeout)
  await service.dispose().catch(() => undefined)
  server.close()
  app.exit(failed ? 1 : 0)
}).catch((error) => {
  clearTimeout(timeout)
  console.error(error)
  report()
  app.exit(1)
})

app.on('window-all-closed', () => undefined)
