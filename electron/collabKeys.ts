import { app, safeStorage } from 'electron'
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// node's webcrypto.subtle is runtime-compatible with the DOM SubtleCrypto interface; type it as
// such so the JsonWebKey/CryptoKey/BufferSource annotations (from lib.dom) line up.
const subtle = webcrypto.subtle as unknown as SubtleCrypto
const encoder = new TextEncoder()

// TS 5.7 types Uint8Array as Uint8Array<ArrayBufferLike>, which isn't assignable to the DOM
// BufferSource (ArrayBufferView<ArrayBuffer>). These byte views are always ArrayBuffer-backed at
// runtime, so coerce them at the WebCrypto boundary.
const toBufferSource = (view: Uint8Array): BufferSource => view as BufferSource

const COLLAB_KEYS_DIR = 'collab-keys'
const DEVICE_IDENTITY_FILE = 'device-identity.bin'
const DEVICE_ALGORITHM = 'ECDH-P256'
const WRAP_ALGORITHM = 'ECDH-P256+A256GCM'
const RECOVERY_WRAP_ALGORITHM = 'PBKDF2-SHA256+A256GCM'
const RECOVERY_WRAP_ITERATIONS = 210_000

interface StoredCollabDeviceIdentity {
  deviceId: string
  deviceLabel: string
  platform: string
  publicKeyAlgorithm: typeof DEVICE_ALGORITHM
  fingerprint: string
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  createdAt: number
}

export interface CollabDeviceIdentity {
  deviceId: string
  deviceLabel: string
  platform: string
  publicKeyAlgorithm: typeof DEVICE_ALGORITHM
  fingerprint: string
  publicKeyJwk: string
}

export interface WrappedRoomKeyDescriptor {
  wrappedKey: string
  wrapAlgorithm: typeof WRAP_ALGORITHM
  senderPublicKeyJwk: string
  senderDeviceId: string
}

export interface RecoveryKitDescriptor {
  recoveryCode: string
  wrappedKey: string
  wrapAlgorithm: typeof RECOVERY_WRAP_ALGORITHM
  salt: string
  iterations: number
}

interface WrappedRoomKeyEnvelopeV1 {
  v: 1
  alg: typeof WRAP_ALGORITHM
  iv: string
  ciphertext: string
  aad: string
}

interface WrappedRecoveryKeyEnvelopeV1 {
  v: 1
  alg: typeof RECOVERY_WRAP_ALGORITHM
  iv: string
  ciphertext: string
  aad: string
}

function getCollabKeysDirectory(): string {
  return path.join(app.getPath('userData'), COLLAB_KEYS_DIR)
}

function getDeviceIdentityPath(): string {
  return path.join(getCollabKeysDirectory(), DEVICE_IDENTITY_FILE)
}

function ensureCollabKeysDirectory(): void {
  const directory = getCollabKeysDirectory()
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function publicJwkFingerprint(publicKeyJwk: JsonWebKey): string {
  return createHash('sha256')
    .update(JSON.stringify(publicKeyJwk))
    .digest('hex')
    .slice(0, 32)
}

function generateRecoveryCode(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16))
  const hex = Buffer.from(bytes).toString('hex').toUpperCase()
  return hex.match(/.{1,4}/g)?.join('-') ?? hex
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function readStoredIdentity(): StoredCollabDeviceIdentity | null {
  try {
    const filePath = getDeviceIdentityPath()
    if (!fs.existsSync(filePath)) {
      return null
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system.')
    }

    const encrypted = fs.readFileSync(filePath)
    const json = safeStorage.decryptString(encrypted)
    const parsed = JSON.parse(json) as StoredCollabDeviceIdentity
    if (!parsed?.deviceId || !parsed?.publicKeyJwk || !parsed?.privateKeyJwk) {
      return null
    }
    return parsed
  } catch (error) {
    console.error('[collabKeys] Failed to read stored device identity:', error)
    return null
  }
}

function writeStoredIdentity(identity: StoredCollabDeviceIdentity): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system.')
  }

  ensureCollabKeysDirectory()
  const encrypted = safeStorage.encryptString(JSON.stringify(identity))
  fs.writeFileSync(getDeviceIdentityPath(), encrypted)
}

async function generateStoredIdentity(): Promise<StoredCollabDeviceIdentity> {
  const keyPair = await subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits'],
  )

  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey)

  return {
    deviceId: randomUUID(),
    deviceLabel: os.hostname(),
    platform: process.platform,
    publicKeyAlgorithm: DEVICE_ALGORITHM,
    fingerprint: publicJwkFingerprint(publicKeyJwk),
    publicKeyJwk,
    privateKeyJwk,
    createdAt: Date.now(),
  }
}

function toPublicIdentity(identity: StoredCollabDeviceIdentity): CollabDeviceIdentity {
  return {
    deviceId: identity.deviceId,
    deviceLabel: identity.deviceLabel,
    platform: identity.platform,
    publicKeyAlgorithm: identity.publicKeyAlgorithm,
    fingerprint: identity.fingerprint,
    publicKeyJwk: JSON.stringify(identity.publicKeyJwk),
  }
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
}

async function deriveWrapKey(
  privateKeyJwk: JsonWebKey,
  publicKeyJwk: JsonWebKey,
): Promise<CryptoKey> {
  const privateKey = await importPrivateKey(privateKeyJwk)
  const publicKey = await importPublicKey(publicKeyJwk)
  const sharedBits = await subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    256,
  )

  return await subtle.importKey(
    'raw',
    sharedBits,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveRecoveryWrapKey(args: {
  recoveryCode: string
  salt: Uint8Array
  iterations: number
}): Promise<CryptoKey> {
  const recoveryKeyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(normalizeRecoveryCode(args.recoveryCode)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBufferSource(args.salt),
      iterations: args.iterations,
      hash: 'SHA-256',
    },
    recoveryKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function loadStoredIdentityOrThrow(): Promise<StoredCollabDeviceIdentity> {
  const identity = readStoredIdentity()
  if (identity) {
    return identity
  }
  const generated = await generateStoredIdentity()
  writeStoredIdentity(generated)
  return generated
}

export function isCollabEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function ensureCollabDeviceIdentity(): Promise<CollabDeviceIdentity> {
  const identity = await loadStoredIdentityOrThrow()
  return toPublicIdentity(identity)
}

export async function wrapRoomKeyForRecipient(args: {
  roomKeyBase64: string
  recipientPublicKeyJwk: string
}): Promise<WrappedRoomKeyDescriptor> {
  const identity = await loadStoredIdentityOrThrow()
  const wrapKey = await deriveWrapKey(
    identity.privateKeyJwk,
    JSON.parse(args.recipientPublicKeyJwk) as JsonWebKey,
  )

  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const aad = encoder.encode(
    JSON.stringify({
      v: 1,
      alg: WRAP_ALGORITHM,
      senderDeviceId: identity.deviceId,
      senderFingerprint: identity.fingerprint,
    }),
  )
  const plaintext = base64ToBytes(args.roomKeyBase64)
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
    },
    wrapKey,
    toBufferSource(plaintext),
  )

  const envelope: WrappedRoomKeyEnvelopeV1 = {
    v: 1,
    alg: WRAP_ALGORITHM,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    aad: bytesToBase64(aad),
  }

  return {
    wrappedKey: JSON.stringify(envelope),
    wrapAlgorithm: WRAP_ALGORITHM,
    senderPublicKeyJwk: JSON.stringify(identity.publicKeyJwk),
    senderDeviceId: identity.deviceId,
  }
}

export async function unwrapRoomKeyFromSender(args: {
  senderPublicKeyJwk: string
  wrappedKey: string
  wrapAlgorithm?: string
}): Promise<{ roomKeyBase64: string }> {
  const identity = await loadStoredIdentityOrThrow()
  const wrapAlgorithm = args.wrapAlgorithm ?? WRAP_ALGORITHM
  if (wrapAlgorithm !== WRAP_ALGORITHM) {
    throw new Error(`Unsupported room-key wrap algorithm: ${wrapAlgorithm}`)
  }

  const envelope = JSON.parse(args.wrappedKey) as WrappedRoomKeyEnvelopeV1
  if (envelope.v !== 1 || envelope.alg !== WRAP_ALGORITHM) {
    throw new Error('Unsupported wrapped room-key envelope version')
  }

  const wrapKey = await deriveWrapKey(
    identity.privateKeyJwk,
    JSON.parse(args.senderPublicKeyJwk) as JsonWebKey,
  )

  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(base64ToBytes(envelope.iv)),
      additionalData: toBufferSource(base64ToBytes(envelope.aad)),
    },
    wrapKey,
    toBufferSource(base64ToBytes(envelope.ciphertext)),
  )

  return {
    roomKeyBase64: bytesToBase64(new Uint8Array(plaintext)),
  }
}

export async function createRecoveryKit(args: {
  roomKeyBase64: string
  recoveryCode?: string
}): Promise<RecoveryKitDescriptor> {
  const recoveryCode = args.recoveryCode?.trim() || generateRecoveryCode()
  const iterations = RECOVERY_WRAP_ITERATIONS
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const wrapKey = await deriveRecoveryWrapKey({
    recoveryCode,
    salt,
    iterations,
  })

  const aad = encoder.encode(
    JSON.stringify({
      v: 1,
      alg: RECOVERY_WRAP_ALGORITHM,
      iterations,
    }),
  )

  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
    },
    wrapKey,
    toBufferSource(base64ToBytes(args.roomKeyBase64)),
  )

  const envelope: WrappedRecoveryKeyEnvelopeV1 = {
    v: 1,
    alg: RECOVERY_WRAP_ALGORITHM,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    aad: bytesToBase64(aad),
  }

  return {
    recoveryCode,
    wrappedKey: JSON.stringify(envelope),
    wrapAlgorithm: RECOVERY_WRAP_ALGORITHM,
    salt: bytesToBase64(salt),
    iterations,
  }
}

export async function unwrapRoomKeyFromRecoveryKit(args: {
  recoveryCode: string
  wrappedKey: string
  salt: string
  iterations: number
  wrapAlgorithm?: string
}): Promise<{ roomKeyBase64: string }> {
  const wrapAlgorithm = args.wrapAlgorithm ?? RECOVERY_WRAP_ALGORITHM
  if (wrapAlgorithm !== RECOVERY_WRAP_ALGORITHM) {
    throw new Error(`Unsupported recovery wrap algorithm: ${wrapAlgorithm}`)
  }

  const envelope = JSON.parse(args.wrappedKey) as WrappedRecoveryKeyEnvelopeV1
  if (envelope.v !== 1 || envelope.alg !== RECOVERY_WRAP_ALGORITHM) {
    throw new Error('Unsupported recovery-key envelope version')
  }

  const wrapKey = await deriveRecoveryWrapKey({
    recoveryCode: args.recoveryCode,
    salt: base64ToBytes(args.salt),
    iterations: Math.max(1, Math.floor(args.iterations)),
  })

  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(base64ToBytes(envelope.iv)),
      additionalData: toBufferSource(base64ToBytes(envelope.aad)),
    },
    wrapKey,
    toBufferSource(base64ToBytes(envelope.ciphertext)),
  )

  return {
    roomKeyBase64: bytesToBase64(new Uint8Array(plaintext)),
  }
}

export function deleteCollabDeviceIdentity(): { success: boolean; error?: string } {
  try {
    const filePath = getDeviceIdentityPath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete collaboration identity',
    }
  }
}

export function getStoredCollabDeviceIdentitySummary(): CollabDeviceIdentity | null {
  const identity = readStoredIdentity()
  return identity ? toPublicIdentity(identity) : null
}
