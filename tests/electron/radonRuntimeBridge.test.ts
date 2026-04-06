import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { RadonRuntimeBridgeServer } from '../../electron/services/radon/runtimeBridge'

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
}

function createSocketMessageQueue(socket: WebSocket) {
  const queued: Array<{ event: string; payload?: unknown }> = []
  const pending: Array<(message: { event: string; payload?: unknown }) => void> = []

  socket.on('message', (data) => {
    const parsed = JSON.parse(data.toString()) as { event: string; payload?: unknown }
    const resolve = pending.shift()
    if (resolve) {
      resolve(parsed)
      return
    }
    queued.push(parsed)
  })

  return () => new Promise<{ event: string; payload?: unknown }>((resolve) => {
    const next = queued.shift()
    if (next) {
      resolve(next)
      return
    }
    pending.push(resolve)
  })
}

describe('RadonRuntimeBridgeServer', () => {
  const disposables: Array<() => void> = []

  afterEach(() => {
    while (disposables.length > 0) {
      disposables.pop()?.()
    }
  })

  it('acks runtime messages and forwards RNIDE payloads both ways', async () => {
    const bridge = await RadonRuntimeBridgeServer.create()
    disposables.push(() => bridge.dispose())

    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`)
    disposables.push(() => socket.close())
    const takeMessage = createSocketMessageQueue(socket)
    await waitForOpen(socket)

    await expect(takeMessage()).resolves.toEqual({
      event: 'RNIDE_message',
      payload: {
        type: 'retransmit',
        id: 0,
      },
    })

    const envelopePromise = new Promise<{ event: string; payload?: unknown }>((resolve) => {
      const dispose = bridge.onEnvelope((envelope) => {
        dispose()
        resolve(envelope)
      })
    })

    socket.send(JSON.stringify({
      event: 'RNIDE_message',
      payload: {
        id: 4,
        type: 'appReady',
        data: { appKey: 'main' },
      },
    }))

    await expect(takeMessage()).resolves.toEqual({
      event: 'RNIDE_message',
      payload: {
        type: 'ack',
        id: 4,
      },
    })

    await expect(envelopePromise).resolves.toEqual({
      event: 'RNIDE_message',
      payload: {
        id: 4,
        type: 'appReady',
        data: { appKey: 'main' },
      },
    })

    expect(bridge.sendRuntimeMessage({
      type: 'openNavigation',
      data: { id: '/settings' },
    })).toBe(true)

    await expect(takeMessage()).resolves.toEqual({
      event: 'RNIDE_message',
      payload: {
        type: 'openNavigation',
        data: { id: '/settings' },
      },
    })
  })
})
