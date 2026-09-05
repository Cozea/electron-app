const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toOwnedBuffer(bytes: Uint8Array): ArrayBuffer {
  const start = bytes.byteOffset
  const end = start + bytes.byteLength
  return bytes.buffer.slice(start, end) as ArrayBuffer
}

export type EncryptedPayloadKind = 'yjs_update' | 'yjs_snapshot' | 'yjs_awareness'

export interface CipherEnvelopeV1 {
  v: 1
  alg: 'A256GCM'
  kind: EncryptedPayloadKind
  keyVersion: number
  iv: string
  ciphertext: string
  aad: string
  /** Optional encrypted attribution; AAD is authenticated but publicly readable. */
  privateMetadata?: { iv: string; ciphertext: string }
}

export interface EncryptPayloadArgs {
  roomKeyBase64: string
  kind: EncryptedPayloadKind
  keyVersion: number
  plaintext: Uint8Array
  metadata: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function importRoomKey(roomKeyBase64: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    toOwnedBuffer(base64ToBytes(roomKeyBase64)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function generateRoomKeyBase64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64(bytes)
}

export async function encryptPayload(args: EncryptPayloadArgs): Promise<CipherEnvelopeV1> {
  const roomKey = await importRoomKey(args.roomKeyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aadBytes = encoder.encode(JSON.stringify({
    ...args.metadata,
    v: 1,
    kind: args.kind,
    keyVersion: args.keyVersion,
  }))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toOwnedBuffer(iv),
      additionalData: toOwnedBuffer(aadBytes),
    },
    roomKey,
    toOwnedBuffer(args.plaintext),
  )

  let privateMetadata: CipherEnvelopeV1['privateMetadata']
  if (args.privateMetadata) {
    const metadataIv = crypto.getRandomValues(new Uint8Array(12))
    const metadataCiphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toOwnedBuffer(metadataIv),
        // Bind attribution to this update and domain-separate it from code bytes.
        additionalData: toOwnedBuffer(metadataAdditionalData(bytesToBase64(aadBytes))),
      },
      roomKey,
      encoder.encode(JSON.stringify(args.privateMetadata)),
    )
    privateMetadata = {
      iv: bytesToBase64(metadataIv),
      ciphertext: bytesToBase64(new Uint8Array(metadataCiphertext)),
    }
  }

  return {
    v: 1,
    alg: 'A256GCM',
    kind: args.kind,
    keyVersion: args.keyVersion,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    aad: bytesToBase64(aadBytes),
    ...(privateMetadata ? { privateMetadata } : {}),
  }
}

export async function decryptPayload(args: {
  roomKeyBase64: string
  envelope: CipherEnvelopeV1
  expectedKind?: EncryptedPayloadKind
}): Promise<Uint8Array> {
  if (args.envelope.v !== 1 || args.envelope.alg !== 'A256GCM') {
    throw new Error('Unsupported encrypted collaboration envelope')
  }
  if (args.expectedKind && args.expectedKind !== args.envelope.kind) {
    throw new Error(`Unexpected encrypted payload kind: ${args.envelope.kind}`)
  }

  const roomKey = await importRoomKey(args.roomKeyBase64)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toOwnedBuffer(base64ToBytes(args.envelope.iv)),
      additionalData: toOwnedBuffer(base64ToBytes(args.envelope.aad)),
    },
    roomKey,
    toOwnedBuffer(base64ToBytes(args.envelope.ciphertext)),
  )
  return new Uint8Array(plaintext)
}

export function envelopeToBytes(envelope: CipherEnvelopeV1): Uint8Array {
  return encoder.encode(JSON.stringify(envelope))
}

export function bytesToEnvelope(bytes: Uint8Array): CipherEnvelopeV1 {
  return JSON.parse(decoder.decode(bytes)) as CipherEnvelopeV1
}

export function tryParseEnvelope(bytes: Uint8Array): CipherEnvelopeV1 | null {
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as Partial<CipherEnvelopeV1>
    if (parsed?.v === 1 && parsed.alg === 'A256GCM' && typeof parsed.kind === 'string') {
      return parsed as CipherEnvelopeV1
    }
    return null
  } catch {
    return null
  }
}

function metadataAdditionalData(aad: string): Uint8Array {
  return encoder.encode(`cozea:private-attribution:v1:${aad}`)
}

export async function decryptPayloadMetadata(args: {
  roomKeyBase64: string
  envelope: CipherEnvelopeV1
}): Promise<Record<string, unknown>> {
  const encrypted = args.envelope.privateMetadata
  if (!encrypted) return {}
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toOwnedBuffer(base64ToBytes(encrypted.iv)),
      additionalData: toOwnedBuffer(metadataAdditionalData(args.envelope.aad)),
    },
    await importRoomKey(args.roomKeyBase64),
    toOwnedBuffer(base64ToBytes(encrypted.ciphertext)),
  )
  const value: unknown = JSON.parse(decoder.decode(plaintext))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid encrypted attribution')
  }
  return value as Record<string, unknown>
}
