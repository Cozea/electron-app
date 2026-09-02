import { EventEmitter } from "node:events"

import {
  DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
  type DevAppContainedRuntimeAvailability,
  type DevAppContainedRuntimeState,
  type DevAppContainedRuntimeTransportEnvelope,
  type DevAppHostedRuntimeEventsResponse,
  type DevAppHostedRuntimeControlRequest,
  type DevAppHostedRuntimeStartRequest,
  type DevAppHostedRuntimeStartResponse,
} from "../../../../shared/devAppContainedRuntime"
import type {
  ContainedRuntimeListener,
  ContainedRuntimeLogEvent,
  ContainedRuntimeMessageEvent,
  ContainedRuntimeStateEvent,
} from "./ContainedDevAppRuntimeService"

const START_REQUEST_TIMEOUT_MS = 6 * 60_000
const REQUEST_TIMEOUT_MS = 30_000
const EVENT_REQUEST_TIMEOUT_MS = 30_000
const LEASE_RENEW_INTERVAL_MS = 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const RUNTIME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface HostedContainedRuntimeStartRequest extends DevAppHostedRuntimeStartRequest {
  gatewayBaseUrl: string
  accessToken: string
}

interface HostedSession {
  request: HostedContainedRuntimeStartRequest
  state: DevAppContainedRuntimeState
  transportUrl: string
  transportToken: string
  controlToken: string
  serviceUrl: string | null
  serviceToken: string | null
  cursor: number
  nextLeaseRenewalAt: number
  abort: AbortController
}

function cleanGatewayUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new Error("The hosted DevApp gateway must use HTTPS.")
  }
  return url.origin
}

function cleanExposedUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`)
  const url = new URL(value)
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`)
  return url.origin
}

function assertAccessToken(value: string): void {
  if (!value.trim() || value.length > 16_384) {
    throw new Error("An authenticated device session is required to start this hosted DevApp.")
  }
}

function hostedRequestBody(request: HostedContainedRuntimeStartRequest): DevAppHostedRuntimeStartRequest {
  return {
    runtimeId: request.runtimeId,
    identity: request.identity,
    location: request.location,
    state: request.state,
    environment: request.environment,
    ...(request.servicePort ? { servicePort: request.servicePort } : {}),
    network: request.network,
    resources: request.resources,
  }
}

function hostedControlBody(request: HostedContainedRuntimeStartRequest): DevAppHostedRuntimeControlRequest {
  return {
    runtimeId: request.runtimeId,
    identity: request.identity,
    location: request.location,
    state: request.state,
  }
}

function assertTransportEnvelope(value: unknown): DevAppContainedRuntimeTransportEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The hosted DevApp transport returned an invalid event.")
  }
  const envelope = value as DevAppContainedRuntimeTransportEnvelope
  if (
    (envelope.channel !== "host" && envelope.channel !== "view") ||
    (envelope.channel === "view" &&
      (typeof envelope.connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(envelope.connectionId)))
  ) {
    throw new Error("The hosted DevApp transport returned an invalid event.")
  }
  return envelope
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("The hosted DevApp response is too large.")
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error("The hosted DevApp response is too large.")
  }
  return JSON.parse(text) as unknown
}

/** Electron-side adapter for Cloudflare-hosted published runtimes. */
export class HostedContainedDevAppRuntimeService {
  private readonly events = new EventEmitter()
  private readonly sessions = new Map<string, HostedSession>()
  private disposed = false

  on(event: "log", listener: (event: ContainedRuntimeLogEvent) => void): () => void
  on(event: "state", listener: (event: ContainedRuntimeStateEvent) => void): () => void
  on(event: "message", listener: (event: ContainedRuntimeMessageEvent) => void): () => void
  on(event: "log" | "state" | "message", listener: ContainedRuntimeListener): () => void {
    this.events.on(event, listener)
    return () => this.events.off(event, listener)
  }

  availability(): DevAppContainedRuntimeAvailability {
    return {
      available: !this.disposed,
      adapter: this.disposed ? "unavailable" : "hosted",
      protocolVersion: DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
      reason: this.disposed ? "The hosted DevApp runtime service has stopped." : null,
    }
  }

  async start(request: HostedContainedRuntimeStartRequest): Promise<DevAppContainedRuntimeState> {
    if (this.disposed) throw new Error("The hosted DevApp runtime service has stopped.")
    if (!RUNTIME_ID.test(request.runtimeId)) throw new Error("The hosted DevApp runtime ID is invalid.")
    assertAccessToken(request.accessToken)
    const existing = this.sessions.get(request.runtimeId)
    if (existing?.state.status === "running") return existing.state
    const gateway = cleanGatewayUrl(request.gatewayBaseUrl)
    const response = await fetch(`${gateway}/devapps/hosted-runtimes/start`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(hostedRequestBody(request)),
      signal: AbortSignal.timeout(START_REQUEST_TIMEOUT_MS),
    })
    const value = (await boundedJson(response).catch(() => null)) as Partial<DevAppHostedRuntimeStartResponse> | null
    if (!response.ok) {
      const message =
        value && typeof (value as { error?: unknown }).error === "string"
          ? (value as { error: string }).error
          : `The hosted DevApp runtime could not start (${response.status}).`
      throw new Error(message)
    }
    if (
      !value?.state ||
      value.state.runtimeId !== request.runtimeId ||
      value.state.location !== "hosted" ||
      value.state.releaseId !== request.identity.releaseId ||
      value.state.status !== "running" ||
      typeof value.transportToken !== "string" ||
      value.transportToken.length < 32 ||
      value.transportToken.length > 256 ||
      typeof value.controlToken !== "string" ||
      value.controlToken.length < 32 ||
      value.controlToken.length > 256 ||
      (request.servicePort
        ? typeof value.serviceUrl !== "string" ||
          typeof value.serviceToken !== "string" ||
          value.serviceToken.length < 32 ||
          value.serviceToken.length > 256
        : value.serviceUrl !== null || value.serviceToken !== null)
    ) {
      throw new Error("The hosted DevApp gateway returned an invalid runtime.")
    }
    const transportUrl = cleanExposedUrl(value.transportUrl, "The hosted DevApp transport URL")
    const serviceUrl =
      value.serviceUrl === null ? null : cleanExposedUrl(value.serviceUrl, "The hosted DevApp service URL")
    if (serviceUrl !== null && serviceUrl !== transportUrl) {
      throw new Error("The hosted DevApp service must use its authenticated transport origin.")
    }
    const session: HostedSession = {
      request,
      state: value.state,
      transportUrl,
      transportToken: value.transportToken,
      controlToken: value.controlToken,
      serviceUrl,
      serviceToken: value.serviceToken ?? null,
      cursor: 0,
      nextLeaseRenewalAt: Date.now() + LEASE_RENEW_INTERVAL_MS,
      abort: new AbortController(),
    }
    this.sessions.set(request.runtimeId, session)
    this.events.emit("state", { runtimeId: request.runtimeId, state: session.state })
    void this.poll(session)
    return session.state
  }

  serviceUrl(runtimeId: string): string | null {
    return this.sessions.get(runtimeId)?.serviceUrl ?? null
  }

  serviceToken(runtimeId: string): string | null {
    return this.sessions.get(runtimeId)?.serviceToken ?? null
  }

  async inspect(runtimeId: string): Promise<DevAppContainedRuntimeState | null> {
    if (!RUNTIME_ID.test(runtimeId)) throw new Error("The hosted DevApp runtime ID is invalid.")
    return this.sessions.get(runtimeId)?.state ?? null
  }

  async sendMessage(runtimeId: string, transport: DevAppContainedRuntimeTransportEnvelope): Promise<void> {
    const session = this.sessions.get(runtimeId)
    if (!session || session.state.status !== "running") {
      throw new Error("The hosted DevApp runtime is not running.")
    }
    assertTransportEnvelope(transport)
    const response = await fetch(`${session.transportUrl}/v1/message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.transportToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(transport),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`The hosted DevApp transport rejected a message (${response.status}).`)
  }

  async stop(runtimeId: string): Promise<DevAppContainedRuntimeState> {
    const session = this.sessions.get(runtimeId)
    if (!session) throw new Error("The hosted DevApp runtime is not running.")
    session.abort.abort()
    const gateway = cleanGatewayUrl(session.request.gatewayBaseUrl)
    const response = await fetch(`${gateway}/devapps/hosted-runtimes/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cozea-hosted-runtime-token": session.controlToken,
      },
      body: JSON.stringify(hostedControlBody(session.request)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`The hosted DevApp runtime could not stop (${response.status}).`)
    const state: DevAppContainedRuntimeState = {
      ...session.state,
      status: "stopped",
      exitedAt: Date.now(),
      exitCode: null,
      error: null,
    }
    session.state = state
    this.sessions.delete(runtimeId)
    this.events.emit("state", { runtimeId, state })
    return state
  }

  async delete(runtimeId: string): Promise<DevAppContainedRuntimeState | null> {
    const session = this.sessions.get(runtimeId)
    if (!session) return null
    session.abort.abort()
    this.sessions.delete(runtimeId)
    return session.state
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const session of this.sessions.values()) session.abort.abort()
    this.sessions.clear()
    this.events.removeAllListeners()
  }

  private async poll(session: HostedSession): Promise<void> {
    while (!session.abort.signal.aborted && this.sessions.get(session.request.runtimeId) === session) {
      try {
        if (Date.now() >= session.nextLeaseRenewalAt) await this.renewLease(session)
        const response = await fetch(`${session.transportUrl}/v1/events?cursor=${session.cursor}`, {
          headers: { authorization: `Bearer ${session.transportToken}` },
          signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(EVENT_REQUEST_TIMEOUT_MS)]),
        })
        if (response.status === 409) throw new Error("The hosted DevApp event cursor expired.")
        if (!response.ok) throw new Error(`The hosted DevApp event stream failed (${response.status}).`)
        const value = (await boundedJson(response)) as DevAppHostedRuntimeEventsResponse
        if (
          !Number.isSafeInteger(value.cursor) ||
          value.cursor < session.cursor ||
          !Array.isArray(value.events) ||
          value.events.length > 512
        ) {
          throw new Error("The hosted DevApp event stream returned invalid state.")
        }
        for (const event of value.events) {
          if (!Number.isSafeInteger(event.cursor) || event.cursor <= session.cursor) {
            throw new Error("The hosted DevApp event stream returned an invalid cursor.")
          }
          session.cursor = event.cursor
          this.events.emit("message", {
            runtimeId: session.request.runtimeId,
            transport: assertTransportEnvelope(event.envelope),
          })
        }
        session.cursor = value.cursor
      } catch (error) {
        if (session.abort.signal.aborted) return
        const message = error instanceof Error ? error.message : "The hosted DevApp transport failed."
        session.state = {
          ...session.state,
          status: "failed",
          exitedAt: Date.now(),
          exitCode: 1,
          error: message,
        }
        this.events.emit("log", {
          runtimeId: session.request.runtimeId,
          stream: "system",
          message,
        })
        this.events.emit("state", { runtimeId: session.request.runtimeId, state: session.state })
        return
      }
    }
  }

  private async renewLease(session: HostedSession): Promise<void> {
    const gateway = cleanGatewayUrl(session.request.gatewayBaseUrl)
    const response = await fetch(`${gateway}/devapps/hosted-runtimes/renew`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cozea-hosted-runtime-token": session.controlToken,
      },
      body: JSON.stringify(hostedControlBody(session.request)),
      signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
    if (!response.ok) {
      throw new Error(`The hosted DevApp runtime lease could not renew (${response.status}).`)
    }
    session.nextLeaseRenewalAt = Date.now() + LEASE_RENEW_INTERVAL_MS
  }
}
