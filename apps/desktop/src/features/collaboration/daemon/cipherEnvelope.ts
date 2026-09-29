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
}

export interface EncryptPayloadArgs {
  roomKeyBase64: string
  kind: EncryptedPayloadKind
  keyVersion: number
  plaintext: Uint8Array
  metadata: Record<string, unknown>
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
    v: 1,
    kind: args.kind,
    keyVersion: args.keyVersion,
    ...args.metadata,
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

  return {
    v: 1,
    alg: 'A256GCM',
    kind: args.kind,
    keyVersion: args.keyVersion,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    aad: bytesToBase64(aadBytes),
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
