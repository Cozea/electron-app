const WebSocket = require('ws')

const PAGE_WS =
  process.env.CDP_PAGE_WS ??
  'ws://127.0.0.1:9224/devtools/page/7ADB44E0FFCA177E926C97A67BC0C5DE'

const ws = new WebSocket(PAGE_WS)
let id = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (!msg.id || !pending.has(msg.id)) {
    return
  }

  const { resolve, reject } = pending.get(msg.id)
  pending.delete(msg.id)

  if (msg.error) {
    reject(new Error(msg.error.message || JSON.stringify(msg.error)))
    return
  }

  resolve(msg.result)
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function evalPage(expression, options = {}) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise ?? false,
    returnByValue: true,
  })
  return result.result.value
}

async function move(x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  })
}

async function click(x, y) {
  await move(x, y)
  await sleep(70)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  await sleep(180)
}

async function waitFor(check, timeout = 8000, interval = 120) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await check()
    if (value) {
      return value
    }
    await sleep(interval)
  }
  throw new Error('Timed out waiting for condition')
}

async function getSessionInfo() {
  return evalPage(`(() => {
    const root = document.querySelector('[data-workbench-session-key]')
    const sessionKey = root?.getAttribute('data-workbench-session-key') ?? ''
    const [projectId, laneId] = sessionKey.split('::')
    return { sessionKey, projectId, laneId }
  })()`)
}

async function resetWorkbench() {
  const info = await getSessionInfo()
  await evalPage(
    `(async () => {
      const mod = await import('/src/stores/useProjectWorkbenchStore.ts')
      mod.useProjectWorkbenchStore.getState().actions.resetWorkbench(${JSON.stringify(info.projectId)}, ${JSON.stringify(info.laneId)})
      return true
    })()`,
    { awaitPromise: true },
  )
  await sleep(250)
  await waitFor(async () => {
    const button = await getTerminalChoicePoint()
    return button
  }, 6000, 100)
  return info
}

async function getTerminalChoicePoint() {
  return evalPage(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => {
      const text = candidate.innerText?.trim() ?? ''
      if (!text.startsWith('Terminal')) return false
      if (!text.includes('local shell')) return false
      const rect = candidate.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
}

async function clickTerminalChoice() {
  const point = await waitFor(() => getTerminalChoicePoint(), 4000, 100)
  await click(point.x, point.y)
}

async function getGroups() {
  return evalPage(`(() => {
    return [...document.querySelectorAll('.dv-groupview')].map((el, index) => {
      const rect = el.getBoundingClientRect()
      const tabs = [...el.querySelectorAll('.dv-tab')]
        .map((tab) => tab.textContent?.trim())
        .filter(Boolean)
      const closeButton = el.querySelector('button[aria-label^="Close "]')
      const closeRect = closeButton ? closeButton.getBoundingClientRect() : null
      return {
        index,
        tabs,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        closeLabel: closeButton?.getAttribute('aria-label') ?? null,
        closeX: closeRect ? closeRect.left + closeRect.width / 2 : null,
        closeY: closeRect ? closeRect.top + closeRect.height / 2 : null,
      }
    })
  })()`)
}

async function getPreviewLabel() {
  return evalPage(`(() => {
    const text = document.body.innerText
    const match = text.match(/(?:EDGE|SEAM|JUNCTION) SPLIT • (?:FULL-SPAN|LOCAL)/i)
    return match ? match[0] : null
  })()`)
}

async function previewFromClick(x, y) {
  await click(x, y)
  return waitFor(() => getPreviewLabel(), 3000, 80)
}

async function ensureSingleTerminal() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let groups = await getGroups()
    const browserGroup = groups.find((group) => group.tabs.includes('Browser'))
    if (browserGroup?.closeX != null && browserGroup?.closeY != null) {
      const beforeCount = groups.length
      await click(browserGroup.closeX, browserGroup.closeY)
      await waitFor(async () => {
        const next = await getGroups()
        return next.length < beforeCount ? next : null
      }, 6000, 100)
      continue
    }

    groups = await getGroups()
    const addTileGroups = groups.filter((group) => group.tabs.includes('Add Tile'))
    const terminalGroups = groups.filter((group) => group.tabs.includes('Terminal'))

    if (groups.length === 1 && terminalGroups.length === 1) {
      return groups
    }

    if (groups.length === 1 && addTileGroups.length === 1) {
      await clickTerminalChoice()
      await waitFor(async () => {
        const next = await getGroups()
        return next.length === 1 && next[0]?.tabs?.includes('Terminal') ? next : null
      }, 6000, 100)
      continue
    }

    if (addTileGroups.length > 0 && terminalGroups.length > 0) {
      const removable = [...terminalGroups].sort((a, b) => b.y - a.y)[0]
      if (removable?.closeX != null && removable?.closeY != null) {
        const beforeCount = groups.length
        await click(removable.closeX, removable.closeY)
        await waitFor(async () => {
          const next = await getGroups()
          return next.length < beforeCount ? next : null
        }, 6000, 100)
        continue
      }
    }

    if (terminalGroups.length > 1) {
      const removable = [...terminalGroups].sort((a, b) => b.y - a.y)[0]
      if (removable?.closeX != null && removable?.closeY != null) {
        const beforeCount = groups.length
        await click(removable.closeX, removable.closeY)
        await waitFor(async () => {
          const next = await getGroups()
          return next.length < beforeCount ? next : null
        }, 6000, 100)
        continue
      }
    }

    if (groups.length === 0) {
      await resetWorkbench()
      continue
    }

    throw new Error(`Unable to normalize workbench from state: ${JSON.stringify(groups)}`)
  }

  throw new Error('Failed to normalize to a single terminal after repeated attempts')
}

async function buildTwoColumns() {
  let groups = await ensureSingleTerminal()
  const g = groups[0]
  await previewFromClick(g.right - 3, g.y + g.height / 2)
  await clickTerminalChoice()
  groups = await waitFor(async () => {
    const next = await getGroups()
    const terminalCount = next.filter((group) => group.tabs.includes('Terminal')).length
    const addTileCount = next.filter((group) => group.tabs.includes('Add Tile')).length
    return next.length === 2 && terminalCount === 2 && addTileCount === 0 ? next : null
  }, 6000, 100)
  await sleep(350)
  return groups
}

async function buildTLayout() {
  let groups = await buildTwoColumns()
  const right = [...groups].sort((a, b) => b.x - a.x)[0]
  await previewFromClick(right.x + right.width / 2, right.bottom - 3)
  await clickTerminalChoice()
  groups = await waitFor(async () => {
    const next = await getGroups()
    const terminalCount = next.filter((group) => group.tabs.includes('Terminal')).length
    const addTileCount = next.filter((group) => group.tabs.includes('Add Tile')).length
    return next.length === 3 && terminalCount === 3 && addTileCount === 0 ? next : null
  }, 6000, 100)
  await sleep(350)
  return groups
}

async function buildTwoByTwo() {
  let groups = await buildTLayout()
  const left = [...groups].sort((a, b) => b.height - a.height)[0]
  await previewFromClick(left.x + left.width / 2, left.bottom - 3)
  await clickTerminalChoice()
  groups = await waitFor(async () => {
    const next = await getGroups()
    const terminalCount = next.filter((group) => group.tabs.includes('Terminal')).length
    const addTileCount = next.filter((group) => group.tabs.includes('Add Tile')).length
    return next.length === 4 && terminalCount === 4 && addTileCount === 0 ? next : null
  }, 6000, 100)
  await sleep(350)
  return groups
}

function findTLayoutGroups(groups) {
  const sortedByX = [...groups].sort((a, b) => a.x - b.x)
  const left = sortedByX[0]
  const rights = sortedByX.slice(1).sort((a, b) => a.y - b.y)
  return { left, rightTop: rights[0], rightBottom: rights[1] }
}

async function main() {
  await send('Runtime.enable')
  await send('Page.enable')

  const results = {}
  const capture = async (label, runner) => {
    console.error(`[live-check] start ${label}`)
    try {
      const value = await runner()
      console.error(`[live-check] done ${label}`)
      return value
    } catch (error) {
      console.error(
        `[live-check] fail ${label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return {
        error: error instanceof Error ? error.message : String(error),
        label,
      }
    }
  }

  const singleEdges = {}
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    singleEdges[edge] = await capture(`single-${edge}`, async () => {
      const groups = await ensureSingleTerminal()
      const g = groups[0]
      let x = g.x + g.width / 2
      let y = g.y + g.height / 2
      if (edge === 'left') x = g.x + 3
      if (edge === 'right') x = g.right - 3
      if (edge === 'top') y = g.y + 3
      if (edge === 'bottom') y = g.bottom - 3
      return previewFromClick(x, y)
    })
  }
  results.singleTile = singleEdges

  results.twoColumns = await capture('two-columns', async () => {
    let groups = await buildTwoColumns()
    groups = [...groups].sort((a, b) => a.x - b.x)
    return {
      groupRects: groups,
      centerSeam: await previewFromClick(groups[0].right, groups[0].y + groups[0].height / 2),
    }
  })

  results.tLayout = {
    leftOuterEdge: await capture('t-left-edge', async () => {
      const groups = await buildTLayout()
      const { left } = findTLayoutGroups(groups)
      return {
        groupRects: groups,
        preview: await previewFromClick(left.x + 3, left.y + left.height / 2),
      }
    }),
    rightTopOuterEdge: await capture('t-right-top-edge', async () => {
      const groups = await buildTLayout()
      const { rightTop } = findTLayoutGroups(groups)
      return {
        groupRects: groups,
        preview: await previewFromClick(rightTop.right - 3, rightTop.y + rightTop.height / 2),
      }
    }),
    rightBottomOuterEdge: await capture('t-right-bottom-edge', async () => {
      const groups = await buildTLayout()
      const { rightBottom } = findTLayoutGroups(groups)
      return {
        groupRects: groups,
        preview: await previewFromClick(rightBottom.right - 3, rightBottom.y + rightBottom.height / 2),
      }
    }),
    junction: await capture('t-junction', async () => {
      const groups = await buildTLayout()
      const { left, rightTop } = findTLayoutGroups(groups)
      return {
        groupRects: groups,
        preview: await previewFromClick(left.right - 6, rightTop.bottom),
      }
    }),
  }

  results.twoByTwo = {
    exactCross: await capture('2x2-exact-cross', async () => {
      const groups = await buildTwoByTwo()
      const topRow = [...groups]
        .sort((a, b) => a.y - b.y)
        .slice(0, 2)
        .sort((a, b) => a.x - b.x)

      await click(topRow[0].right, topRow[0].bottom)
      await sleep(250)
      return {
        groupRects: groups,
        preview: await getPreviewLabel(),
      }
    }),
    upperVerticalSeam: await capture('2x2-upper-vertical-seam', async () => {
      const groups = await buildTwoByTwo()
      const topRow = [...groups]
        .sort((a, b) => a.y - b.y)
        .slice(0, 2)
        .sort((a, b) => a.x - b.x)
      return {
        groupRects: groups,
        preview: await previewFromClick(topRow[0].right, topRow[0].y + topRow[0].height / 2),
      }
    }),
  }

  console.log(JSON.stringify(results, null, 2))
}

ws.on('open', async () => {
  try {
    await main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    ws.close()
  }
})

ws.on('close', () => {
  process.exit(process.exitCode ?? 0)
})
