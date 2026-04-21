import http from 'node:http'
import process from 'node:process'
import { WebSocket } from 'ws'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on('error', reject)
  })
}

async function main() {
  const port = process.argv[2] || '9224'
  const expression =
    process.argv[3] ||
    (await new Promise((resolve, reject) => {
      if (process.stdin.isTTY) {
        resolve('')
        return
      }

      let input = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => {
        input += chunk
      })
      process.stdin.on('end', () => resolve(input.trim()))
      process.stdin.on('error', reject)
    }))
  if (!expression) {
    throw new Error('Missing JS expression argument')
  }

  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const page =
    targets.find(
      (target) =>
        target.type === 'page' &&
        (target.title === 'Cozea' || String(target.url).includes('/projects/')),
    ) || targets.find((target) => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No page target found on CDP port ${port}`)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    if (!msg.id || !pending.has(msg.id)) {
      return
    }
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) {
      reject(new Error(msg.error.message || 'CDP error'))
      return
    }
    resolve(msg.result)
  })

  await new Promise((resolve) => ws.once('open', resolve))
  await send('Runtime.enable')
  await send('Page.enable')
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  console.log(JSON.stringify(result.result.value, null, 2))
  ws.close()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
