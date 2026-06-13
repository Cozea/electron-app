import { z } from 'zod'

import type { ProjectPath } from './projectPath'

export const COLLAB_PROTOCOL_VERSION = '1.0'

export type CollabClientType = 'web' | 'electron'
export type CollabAuthorType = 'user' | 'agent'

export interface CollabCapabilities {
  execution: 'browser-local' | 'vm'
  languageScope: string[]
  preview: boolean
  terminal: boolean
  deployments: boolean
  yjs: boolean
}

export interface CollabHelloMessage {
  type: 'hello'
  payload: {
    protocolVersion: string
    clientType: CollabClientType
    projectId: string
    sessionToken: string
    clientId: string
  }
}

export interface CollabSyncRequestMessage {
  type: 'sync_request'
  payload: {
    roomId: string
    knownSeq: number
    stateVector?: string
  }
}

export interface CollabSyncDeltaMessage {
  type: 'sync_delta'
  payload: {
    roomId: string
    fromSeq: number
    toSeq: number
    updatesBinary: string[]
  }
}

export interface CollabUpdatePushMessage {
  type: 'update_push'
  payload: {
    roomId: string
    seq: number
    idempotencyKey?: string
    updateBinary: string
    authorType: CollabAuthorType
    authorId: string
    timestamp: number
    path?: ProjectPath
  }
}

export interface CollabAwarenessPushMessage {
  type: 'awareness_push'
  payload: {
    roomId: string
    clientId: string
    awarenessBinary: string
    ttlMs: number
  }
}

export interface CollabAckMessage {
  type: 'ack'
  payload: {
    roomId: string
    seq: number
    persisted: boolean
  }
}

export interface CollabErrorMessage {
  type: 'error'
  payload: {
    code: string
    message: string
    recoverable: boolean
    retryAfterMs?: number
  }
}

export type CollabWireMessage =
  | CollabHelloMessage
  | CollabSyncRequestMessage
  | CollabSyncDeltaMessage
  | CollabUpdatePushMessage
  | CollabAwarenessPushMessage
  | CollabAckMessage
  | CollabErrorMessage

export const collabClientTypeSchema = z.enum(['web', 'electron'])
export const collabAuthorTypeSchema = z.enum(['user', 'agent'])

export const collabHelloMessageSchema = z.object({
  type: z.literal('hello'),
  payload: z.object({
    protocolVersion: z.string().trim().min(1),
    clientType: collabClientTypeSchema,
    projectId: z.string().trim().min(1).max(200),
    sessionToken: z.string().trim().min(1),
    clientId: z.string().trim().min(1).max(200),
  }),
})

export const collabSyncRequestMessageSchema = z.object({
  type: z.literal('sync_request'),
  payload: z.object({
    roomId: z.string().trim().min(1).max(200),
    knownSeq: z.number().int().nonnegative(),
    stateVector: z.string().trim().min(1).optional(),
  }),
})

export const collabSyncDeltaMessageSchema = z.object({
  type: z.literal('sync_delta'),
  payload: z.object({
    roomId: z.string().trim().min(1).max(200),
    fromSeq: z.number().int().nonnegative(),
    toSeq: z.number().int().nonnegative(),
    updatesBinary: z.array(z.string()),
  }),
})

export const collabUpdatePushMessageSchema = z.object({
  type: z.literal('update_push'),
  payload: z.object({
    roomId: z.string().trim().min(1).max(200),
    seq: z.number().int().nonnegative(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    updateBinary: z.string().trim().min(1),
    authorType: collabAuthorTypeSchema,
    authorId: z.string().trim().min(1).max(200),
    timestamp: z.number().int().positive(),
    path: z.string().trim().min(1).optional(),
  }),
})

export const collabAwarenessPushMessageSchema = z.object({
  type: z.literal('awareness_push'),
  payload: z.object({
    roomId: z.string().trim().min(1).max(200),
    clientId: z.string().trim().min(1).max(200),
    awarenessBinary: z.string().trim().min(1),
    ttlMs: z.number().int().positive(),
  }),
})

export const collabAckMessageSchema = z.object({
  type: z.literal('ack'),
  payload: z.object({
    roomId: z.string().trim().min(1).max(200),
    seq: z.number().int().nonnegative(),
    persisted: z.boolean(),
  }),
})

export const collabErrorMessageSchema = z.object({
  type: z.literal('error'),
  payload: z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    recoverable: z.boolean(),
    retryAfterMs: z.number().int().positive().optional(),
  }),
})

export const collabWireMessageSchema = z.discriminatedUnion('type', [
  collabHelloMessageSchema,
  collabSyncRequestMessageSchema,
  collabSyncDeltaMessageSchema,
  collabUpdatePushMessageSchema,
  collabAwarenessPushMessageSchema,
  collabAckMessageSchema,
  collabErrorMessageSchema,
])
