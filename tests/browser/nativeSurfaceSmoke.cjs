// Run with Electron, not `node`: this exercises a real WebContentsView.
//
// Checkpoint PH2-B/PH2-C of the browser WebContentsView migration. Proves a
// main-owned native surface completes its lifecycle and that the exact
// WebContents handed to automation is the one showing the page, with no
// renderer <webview> anywhere in the process.
//
// Driven by scripts/smoke-native-browser-surface.mjs, which compiles the
// TypeScript sources first and passes the output directory in
// COZEA_NATIVE_SURFACE_BUILD.
const { app, BrowserWindow, webContents } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')

const build = process.env.COZEA_NATIVE_SURFACE_BUILD
assert.ok(build, 'COZEA_NATIVE_SURFACE_BUILD must point at the compiled services')

const load = (name) =>
  require(path.join(build, 'apps/desktop/electron/services/browser', name))
const { BrowserSurfaceNativeHost } = load('BrowserSurfaceNativeHost.js')
const { BrowserSurfaceSessionRegistry } = load('BrowserSurfaceSessionRegistry.js')

const PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><title>Native Surface Probe</title>' +
  '<h1 id="heading">main-owned</h1><script>window.__probe = "native-surface-ok"</script>')

const timeout = setTimeout(() => {
  console.error('Native browser surface smoke timed out')
  app.exit(1)
}, 30_000)

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 700, show: false })
  // Shown, so the surface has a real window to be laid out in, but never
  // focused: a smoke run should not steal the developer's keyboard.
  window.showInactive()

  const registered = []
  const revoked = []
  const sessions = new BrowserSurfaceSessionRegistry({
    allowedPermissions: new Set(['clipboard-read']),
    protocols: { registerOrgDevAppProtocol() {}, registerDevAppPreviewProtocol() {} },
  })
  const host = new BrowserSurfaceNativeHost({
    sessions,
    getWindow: () => window,
    // Stands in for the T3 binder: records exactly which contents id the host
    // would vouch for and register.
    automation: {
      attach: async (tabId, webContentsId) => { registered.push({ tabId, webContentsId }) },
      detach: async (webContentsId) => { revoked.push(webContentsId) },
    },
  })

  const descriptor = {
    runtimeTabId: 'rt_probe',
    tileId: 'tile_probe',
    workbenchSessionKey: 'session_probe',
    kind: 'browser',
    title: 'Probe',
    initialUrl: null,
    storageScope: 'ephemeral',
  }

  // create -> hidden
  const surface = await host.ensureSurface(descriptor)
  assert.equal(surface.isVisible, false, 'a new surface must not be drawn before layout')
  assert.equal(surface.isLaidOut, false)
  assert.deepEqual(registered, [{ tabId: 'rt_probe', webContentsId: surface.webContentsId }],
    'automation must be handed the contents the host just created')

  // A second ensure must not produce a second browser (INV-003).
  assert.equal(await host.ensureSurface(descriptor), surface)
  assert.equal(registered.length, 1)

  // layout -> visible
  surface.setVisible(true)
  assert.equal(surface.isVisible, false, 'visibility must wait for real bounds')
  surface.layout({ x: 20, y: 40, width: 640, height: 480 }, 6)
  assert.equal(surface.isVisible, true)
  assert.deepEqual(surface.view.getBounds(), { x: 20, y: 40, width: 640, height: 480 })

  // navigate
  await surface.loadUrl(PAGE)

  // The registered id must resolve to the contents showing the page (INV-006).
  const contents = webContents.fromId(surface.webContentsId)
  assert.ok(contents && !contents.isDestroyed(), 'registered id must resolve to live contents')
  assert.equal(contents, surface.view.webContents)
  assert.equal(contents.getTitle(), 'Native Surface Probe')
  assert.ok(contents.getURL().startsWith('data:text/html'))

  // executeJavaScript is the primitive behind T3 evaluate/snapshot, so this is
  // the same observation path automation uses.
  assert.equal(await contents.executeJavaScript('window.__probe'), 'native-surface-ok')
  assert.equal(await contents.executeJavaScript('document.getElementById("heading").textContent'),
    'main-owned')

  // No renderer guest exists anywhere in this process.
  assert.equal(webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview').length, 0,
    'the native path must not create a <webview>')

  // hide -> show, same browser throughout (INV-004)
  const idBeforeToggle = surface.webContentsId
  surface.setVisible(false)
  assert.equal(surface.isVisible, false)
  surface.setVisible(true)
  assert.equal(surface.isVisible, true)
  assert.equal(surface.webContentsId, idBeforeToggle)
  assert.equal(await contents.executeJavaScript('window.__probe'), 'native-surface-ok',
    'the page must survive a hide/show cycle')

  // An overlay must remove the view from the screen, not sit under it (INV-009).
  surface.setOccluded(true)
  assert.equal(surface.isVisible, false)
  surface.setOccluded(false)
  assert.equal(surface.isVisible, true)

  // destroy
  await host.releaseSurface('rt_probe')
  assert.deepEqual(revoked, [idBeforeToggle], 'the automation vouch must be withdrawn')
  assert.equal(host.has('rt_probe'), false)
  assert.equal(surface.isDisposed, true)

  // ---- PH3-A: navigation, history, title, zoom, find, DevTools ----
  const second = await host.ensureSurface({ ...descriptor, runtimeTabId: 'rt_nav', tileId: 'tile_nav' })
  second.layout({ x: 0, y: 0, width: 800, height: 600 })
  second.setVisible(true)
  const nav = second.view.webContents

  const pageA = 'data:text/html;charset=utf-8,' + encodeURIComponent('<title>Page A</title><h1>A</h1>')
  const pageB = 'data:text/html;charset=utf-8,' + encodeURIComponent('<title>Page B</title><h1>B</h1><p>findable needle</p>')
  await second.loadUrl(pageA)
  assert.equal(nav.getTitle(), 'Page A')
  await second.loadUrl(pageB)
  assert.equal(nav.getTitle(), 'Page B')

  // back / forward against the native contents
  await new Promise((resolve) => { nav.once('did-finish-load', resolve); nav.navigationHistory.goBack() })
  assert.equal(nav.getTitle(), 'Page A', 'back must move the native surface')
  await new Promise((resolve) => { nav.once('did-finish-load', resolve); nav.navigationHistory.goForward() })
  assert.equal(nav.getTitle(), 'Page B', 'forward must move the native surface')

  // reload
  await new Promise((resolve) => { nav.once('did-finish-load', resolve); nav.reload() })
  assert.equal(nav.getTitle(), 'Page B')

  // zoom
  nav.setZoomFactor(1.5)
  assert.ok(Math.abs(nav.getZoomFactor() - 1.5) < 0.001, 'zoom must apply to the native contents')
  nav.setZoomFactor(1)

  // find-in-page
  // find-in-page is deliberately not asserted here. It searches rendered
  // content, and a WebContentsView in this harness reports
  // document.visibilityState 'hidden' and never runs requestAnimationFrame, so
  // a search is timing-dependent rather than a real signal. It stays on the
  // manual PH3-A acceptance list.

  // DevTools targets this surface's contents, and detaches cleanly.
  // Opening and closing are asynchronous, so wait on the events rather than
  // polling immediately after the call.
  await new Promise((resolve) => { nav.once('devtools-opened', resolve); nav.openDevTools({ mode: 'detach' }) })
  assert.equal(nav.isDevToolsOpened(), true, 'DevTools must open on the native contents')
  await new Promise((resolve) => { nav.once('devtools-closed', resolve); nav.closeDevTools() })
  assert.equal(nav.isDevToolsOpened(), false, 'DevTools must detach cleanly')

  await host.releaseSurface('rt_nav')

  // ---- PH3-D: storage parity across real Electron sessions ----
  const workspaceOne = sessions.resolve({ ...descriptor, storageScope: 'workspace', workspaceId: 'ws_1', tileId: 't1' })
  const workspaceOneAgain = sessions.resolve({ ...descriptor, storageScope: 'workspace', workspaceId: 'ws_1', tileId: 't2' })
  const workspaceTwo = sessions.resolve({ ...descriptor, storageScope: 'workspace', workspaceId: 'ws_2', tileId: 't3' })
  const ephemeralOne = sessions.resolve({ ...descriptor, storageScope: 'ephemeral', tileId: 'eph_1' })
  const ephemeralTwo = sessions.resolve({ ...descriptor, storageScope: 'ephemeral', tileId: 'eph_2' })

  const cookie = { url: 'https://cozea.test/', name: 'parity', value: 'shared' }
  await workspaceOne.cookies.set(cookie)

  const readCookie = async (target) =>
    (await target.cookies.get({ url: 'https://cozea.test/', name: 'parity' })).length

  assert.equal(await readCookie(workspaceOneAgain), 1,
    'two surfaces in one workspace must share storage')
  assert.equal(await readCookie(workspaceTwo), 0,
    'different workspaces must not share storage')

  await ephemeralOne.cookies.set({ ...cookie, value: 'first' })
  assert.equal(await readCookie(ephemeralTwo), 0,
    'ephemeral surfaces must stay isolated from each other')
  assert.equal(await readCookie(workspaceOne), 1,
    'an ephemeral surface must not write into workspace storage')

  await workspaceOne.clearStorageData({ storages: ['cookies'] })

  clearTimeout(timeout)
  console.log('Native browser surface smoke passed')
  app.exit(0)
}).catch((error) => {
  clearTimeout(timeout)
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
