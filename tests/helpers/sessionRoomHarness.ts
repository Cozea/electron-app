import path from "node:path"

import {
  SESSION_ROOM_PROTOCOL_VERSION,
  type RoomConnection,
  type RoomConnectionHandlers,
  type RoomConnector,
} from "../../apps/projectd/src/collaboration/SessionRoomClient"

/**
 * Runs the real CollaborationSessionRoom Durable Object code in memory, with
 * stand-ins for Durable Object storage and hibernatable sockets. Worker modules
 * load by runtime path because the tests typecheck project does not include the
 * Cloudflare ambient types; cloudflare/worker/tsconfig.json checks them.
 */

export const TEST_PUBLIC_SESSION_ID = "czs_0123456789abcdef"
export const TEST_ROOM_ID = `session:${TEST_PUBLIC_SESSION_ID}`
export const TEST_ROOM_ENV = { COLLAB_JWT_SECRET: "session-room-test-secret-0123456789" }

export type ServerMessage = { type: string; [key: string]: unknown }
export type SessionRole = "viewer" | "developer" | "project_manager"

interface RoomInstance {
  acceptSocket(socket: FakeServerSocket, roomId: string): void
  webSocketMessage(socket: FakeServerSocket, message: string): Promise<void>
}

export interface SessionRoomWorker {
  CollaborationSessionRoom: new (state: FakeRoomState, env: typeof TEST_ROOM_ENV) => RoomInstance
  SESSION_ROOM_PROTOCOL_VERSION: string
  signSessionToken(
    env: typeof TEST_ROOM_ENV,
    claims: Record<string, unknown>,
    ttlSeconds?: number,
  ): Promise<string>
}

function loadWorkerModule(relativePath: string): Promise<unknown> {
  return import(/* @vite-ignore */ path.resolve(process.cwd(), relativePath))
}

export async function loadSessionRoomWorker(): Promise<SessionRoomWorker> {
  const room = (await loadWorkerModule(
    "cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts",
  )) as Pick<SessionRoomWorker, "CollaborationSessionRoom" | "SESSION_ROOM_PROTOCOL_VERSION">
  const jwt = (await loadWorkerModule("cloudflare/worker/src/lib/jwt.ts")) as Pick<SessionRoomWorker, "signSessionToken">
  return {
    CollaborationSessionRoom: room.CollaborationSessionRoom,
    SESSION_ROOM_PROTOCOL_VERSION: room.SESSION_ROOM_PROTOCOL_VERSION,
    signSessionToken: jwt.signSessionToken,
  }
}

export class FakeStorage {
  readonly data = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.data.set(keyOrEntries, structuredClone(value))
      return
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) this.data.set(key, structuredClone(entry))
  }

  async list<T>(options: { prefix?: string; start?: string; limit?: number }): Promise<Map<string, T>> {
    const keys = [...this.data.keys()]
      .filter((key) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start))
      .sort()
      .slice(0, options.limit)
    return new Map(keys.map((key) => [key, structuredClone(this.data.get(key)) as T]))
  }

  batchCount(): number {
    return [...this.data.keys()].filter((key) => key.startsWith("batch:")).length
  }
}

export interface FakeRoomState {
  storage: FakeStorage
  blockConcurrencyWhile(fn: () => Promise<void>): Promise<void>
  acceptWebSocket(socket: FakeServerSocket): void
  getWebSockets(): FakeServerSocket[]
}

/** Server end of a hibernatable socket; messages reach the client on a later microtask. */
export class FakeServerSocket {
  closed = false
  readonly received: ServerMessage[] = []
  private attachment: unknown = null
  private readonly handlers: RoomConnectionHandlers
  private readonly dropServerMessage: (message: ServerMessage) => boolean

  constructor(handlers: RoomConnectionHandlers, dropServerMessage: (message: ServerMessage) => boolean) {
    this.handlers = handlers
    this.dropServerMessage = dropServerMessage
  }

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  send(data: string): void {
    if (this.closed) throw new Error("socket closed")
    const message = JSON.parse(data) as ServerMessage
    this.received.push(message)
    if (this.dropServerMessage(message)) return
    queueMicrotask(() => this.handlers.onMessage(data))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    queueMicrotask(() => this.handlers.onClose())
  }
}

/**
 * Hosts the room the way the runtime does: one instance at a time over durable
 * storage, sockets that outlive an eviction, and one event delivered at a time.
 */
export class RoomHost {
  readonly storage = new FakeStorage()
  readonly sockets: FakeServerSocket[] = []
  private readonly worker: SessionRoomWorker
  private room: RoomInstance
  private delivery: Promise<void> = Promise.resolve()

  constructor(worker: SessionRoomWorker) {
    this.worker = worker
    this.room = this.instantiate()
  }

  /** Hibernation eviction: a fresh instance that must rebuild itself from storage. */
  evict(): void {
    this.room = this.instantiate()
  }

  connector(options: { roomId?: string; dropServerMessage?: (message: ServerMessage) => boolean } = {}): RoomConnector {
    return async (handlers) => {
      const socket = new FakeServerSocket(handlers, options.dropServerMessage ?? (() => false))
      this.room.acceptSocket(socket, options.roomId ?? TEST_ROOM_ID)
      const connection: RoomConnection = {
        send: (data) => {
          if (socket.closed) return
          this.delivery = this.delivery.then(() => this.room.webSocketMessage(socket, data))
        },
        close: () => socket.close(),
      }
      return connection
    }
  }

  private instantiate(): RoomInstance {
    const state: FakeRoomState = {
      storage: this.storage,
      blockConcurrencyWhile: (fn) => fn(),
      acceptWebSocket: (socket) => {
        this.sockets.push(socket)
      },
      getWebSockets: () => this.sockets.filter((socket) => !socket.closed),
    }
    return new this.worker.CollaborationSessionRoom(state, TEST_ROOM_ENV)
  }
}

export function sessionTokenFor(
  worker: SessionRoomWorker,
  principalId: string,
  overrides: { roomId?: string; sessionRole?: SessionRole; secret?: string; ttlSeconds?: number } = {},
): () => Promise<string> {
  return () =>
    worker.signSessionToken(
      { COLLAB_JWT_SECRET: overrides.secret ?? TEST_ROOM_ENV.COLLAB_JWT_SECRET },
      {
        sub: `czd_${principalId}`,
        principalId,
        projectId: "proj_room",
        roomId: overrides.roomId ?? TEST_ROOM_ID,
        clientType: "electron",
        protocolVersion: SESSION_ROOM_PROTOCOL_VERSION,
        sessionRole: overrides.sessionRole ?? "developer",
      },
      overrides.ttlSeconds,
    )
}

export async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now()
  while (!(await check())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
