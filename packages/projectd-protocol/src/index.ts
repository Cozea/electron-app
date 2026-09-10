/**
 * Projectd Local Client Protocol
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 *
 * Requirements:
 * - Versioned local Unix-domain socket (/tmp/cozea-projectd-<uid>.sock)
 * - Socket permissions 0600
 * - Explicit protocol version and handshake
 * - Request IDs and request/response matching
 * - Typed structured errors
 * - Streaming event subscriptions
 * - Graceful shutdown
 */

export const PROJECTD_PROTOCOL_VERSION = "1.0.0"
export const PROJECTD_DEFAULT_DAEMON_VERSION = "0.2.3"

export function getProjectdSocketPath(uid?: number): string {
  if (process.env.COZEA_PROJECTD_SOCKET) {
    return process.env.COZEA_PROJECTD_SOCKET
  }
  const effectiveUid = uid ?? (typeof process.getuid === "function" ? process.getuid() : 501)
  return `/tmp/cozea-projectd-${effectiveUid}.sock`
}

export type ProjectdErrorCode =
  | "INVALID_HANDSHAKE"
  | "UNSUPPORTED_VERSION"
  | "METHOD_NOT_FOUND"
  | "INVALID_PARAMS"
  | "INTERNAL_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CANCELLED"
  | "SHUTTING_DOWN"

export interface ProjectdError {
  code: ProjectdErrorCode
  message: string
  details?: unknown
}

// ─── Wire Messages ─────────────────────────────────────────────────────────────

export interface ProjectdHandshakeRequest {
  type: "handshake"
  id: string
  protocolVersion: string
  clientName: string
  clientVersion?: string
}

export interface ProjectdHandshakeResponse {
  type: "handshake_ack"
  id: string
  success: boolean
  protocolVersion: string
  daemonVersion: string
  pid: number
  error?: ProjectdError
}

export interface ProjectdRequest<P = unknown> {
  type: "request"
  id: string
  method: string
  params?: P
}

export interface ProjectdSuccessResponse<R = unknown> {
  type: "response"
  id: string
  success: true
  result: R
}

export interface ProjectdErrorResponse {
  type: "response"
  id: string
  success: false
  error: ProjectdError
}

export type ProjectdResponse<R = unknown> = ProjectdSuccessResponse<R> | ProjectdErrorResponse

export interface ProjectdSubscribeRequest {
  type: "subscribe"
  id: string
  topic: string
}

export interface ProjectdUnsubscribeRequest {
  type: "unsubscribe"
  id: string
  topic: string
}

export interface ProjectdEventMessage<P = unknown> {
  type: "event"
  topic: string
  event: string
  payload: P
  timestamp: number
}

export type ProjectdClientMessage =
  | ProjectdHandshakeRequest
  | ProjectdRequest
  | ProjectdSubscribeRequest
  | ProjectdUnsubscribeRequest

export type ProjectdServerMessage =
  | ProjectdHandshakeResponse
  | ProjectdResponse
  | ProjectdEventMessage

// ─── Standard Method Payloads ──────────────────────────────────────────────────

export interface ProjectdHealthResult {
  status: "healthy" | "degraded"
  version: string
  protocolVersion: string
  pid: number
  uptimeSeconds: number
  activeConnections: number
  startedAt: number
}

export interface ProjectdShutdownParams {
  reason?: string
}

export interface ProjectdShutdownResult {
  shuttingDown: true
}

// ─── Framing utilities (Line-delimited JSON) ───────────────────────────────────

export function encodeMessage(msg: ProjectdClientMessage | ProjectdServerMessage): string {
  return JSON.stringify(msg) + "\n"
}

export class LineMessageDecoder {
  private buffer = ""

  push(chunk: string | Buffer): (ProjectdClientMessage | ProjectdServerMessage)[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    const messages: (ProjectdClientMessage | ProjectdServerMessage)[] = []

    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        try {
          messages.push(JSON.parse(line))
        } catch (err) {
          console.error("[LineMessageDecoder] Malformed message:", line, err)
        }
      }
    }

    return messages
  }
}

export * from "./client"

