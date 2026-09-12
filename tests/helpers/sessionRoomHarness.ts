import path from "node:path"

import {
  SESSION_ROOM_PROTOCOL_VERSION,
  type RoomConnection,
  type RoomConnectionHandlers,
  type RoomConnector,
} from "../../apps/projectd/src/collaboration/SessionRoomClient"

/**
 * Runs the real CollaborationSessionRoom Durable Object code in memory, with
 * stand-ins for Durable Object storage, alarms and hibernatable sockets. Worker
 * modules load by runtime path because the tests typecheck project does not include
 * the Cloudflare ambient types; cloudflare/worker/tsconfig.json checks them.
 */

export const TEST_PUBLIC_SESSION_ID = "czs_0123456789abcdef"
export const TEST_ROOM_ID = `session:${TEST_PUBLIC_SESSION_ID}`
export const TEST_ROOM_ENV = { COLLAB_JWT_SECRET: "session-room-test-secret-0123456789" }

export type ServerMessage = { type: string; [key: string]: unknown }
export type SessionRole = "viewer" | "developer" | "project_manager"
type RoomEnv = typeof TEST_ROOM_ENV & { CONVEX_URL?: string; AI_GATEWAY_SECRET?: string; AUTOGIT_LEASE_MS?: string; COLLAB_BINARY_OBJECTS?: { head(key: string): Promise<{ size: number } | null> } }

interface RoomInstance {
  acceptSocket(socket: FakeServerSocket, roomId: string): void
  webSocketMessage(socket: FakeServerSocket, message: string): Promise<void>
  webSocketClose(socket: FakeServerSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>
  alarm(): Promise<void>
}

export interface SessionRoomWorker {
  CollaborationSessionRoom: new (state: FakeRoomState, env: RoomEnv) => RoomInstance
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
  alarm: number | null = null
  onAlarmChange: ((time: number | null) => void) | null = null

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

  async setAlarm(time: number | Date): Promise<void> {
    this.alarm = typeof time === "number" ? time : time.getTime()
    this.onAlarmChange?.(this.alarm)
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async transaction<T>(work: (storage: FakeStorage) => Promise<T>): Promise<T> {
    const before = structuredClone(this.data)
    const beforeAlarm = this.alarm
    try {
      return await work(this)
    } catch (error) {
      this.data.clear()
      for (const [key, value] of before) this.data.set(key, value)
      this.alarm = beforeAlarm
      this.onAlarmChange?.(beforeAlarm)
      throw error
    }
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null
    this.onAlarmChange?.(null)
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
 * storage, sockets that outlive an eviction, an alarm that fires on time, and one
 * event delivered at a time.
 */
export class RoomHost {
  readonly storage = new FakeStorage()
  readonly sockets: FakeServerSocket[] = []
  /** Errors the room threw while handling an event. */
  readonly errors: unknown[] = []
  private readonly worker: SessionRoomWorker
  private readonly env: RoomEnv
  private room: RoomInstance
  private delivery: Promise<void> = Promise.resolve()
  private alarmTimer: NodeJS.Timeout | null = null

  constructor(worker: SessionRoomWorker, options: { leaseMs?: number; binaryObjects?: RoomEnv["COLLAB_BINARY_OBJECTS"];
    controlPlane?: { convexUrl: string; serverSecret: string } } = {}) {
    this.worker = worker
    this.env = { ...TEST_ROOM_ENV, AUTOGIT_LEASE_MS: options.leaseMs ? String(options.leaseMs) : undefined,
      COLLAB_BINARY_OBJECTS: options.binaryObjects, CONVEX_URL: options.controlPlane?.convexUrl,
      AI_GATEWAY_SECRET: options.controlPlane?.serverSecret }
    this.storage.onAlarmChange = (time) => this.scheduleAlarm(time)
    this.room = this.instantiate()
  }

  /** Hibernation eviction: a fresh instance that must rebuild itself from storage. */
  evict(): void {
    this.room = this.instantiate()
  }

  /** Stops the alarm clock; call when the test is done with the room. */
  dispose(): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer)
    this.alarmTimer = null
    this.storage.onAlarmChange = null
  }

  /** Waits until the room has handled every event delivered so far. */
  settled(): Promise<void> {
    return this.delivery
  }

  connector(options: { roomId?: string; dropServerMessage?: (message: ServerMessage) => boolean; onClientMessage?: (message: ServerMessage) => void } = {}): RoomConnector {
    return async (handlers) => {
      const socket = new FakeServerSocket(handlers, options.dropServerMessage ?? (() => false))
      this.room.acceptSocket(socket, options.roomId ?? TEST_ROOM_ID)
      const connection: RoomConnection = {
        send: (data) => {
          if (socket.closed) return
          options.onClientMessage?.(JSON.parse(data) as ServerMessage)
          this.deliver((room) => room.webSocketMessage(socket, data))
        },
        close: () => {
          if (socket.closed) return
          socket.close()
          this.deliver((room) => room.webSocketClose(socket, 1000, "client closed", true))
        },
      }
      return connection
    }
  }

  private deliver(event: (room: RoomInstance) => void | Promise<void>): void {
    this.delivery = this.delivery
      .then(() => event(this.room))
      .catch((error: unknown) => {
        this.errors.push(error)
      })
  }

  private scheduleAlarm(time: number | null): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer)
    this.alarmTimer = null
    if (time === null) return
    this.alarmTimer = setTimeout(
      () => {
        this.alarmTimer = null
        this.storage.alarm = null
        this.deliver((room) => room.alarm())
      },
      Math.max(0, time - Date.now()),
    )
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
    return new this.worker.CollaborationSessionRoom(state, this.env)
  }
}

export function sessionTokenFor(
  worker: SessionRoomWorker,
  principalId: string,
  overrides: { roomId?: string; sessionRole?: SessionRole; secret?: string; ttlSeconds?: number; sessionAccess?: 'recovery' | 'paused_close' } = {},
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
        ...(overrides.sessionAccess ? { sessionAccess: overrides.sessionAccess } : {}),
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
