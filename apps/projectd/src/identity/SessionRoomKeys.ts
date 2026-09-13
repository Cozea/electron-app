import { createPrivateKey, createPublicKey, diffieHellman, createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { StoredDeviceIdentity } from "./BackgroundDeviceIdentity"

const ALGORITHM = "ECDH-P256+A256GCM"
interface WrappedKey {
  wrappedKey: string
  senderPublicKeyJwk: string
  wrapAlgorithm: string
}

function wrapKey(identity: StoredDeviceIdentity, publicJwk: string): Buffer {
  return diffieHellman({
    privateKey: createPrivateKey({ key: identity.privateKeyJwk, format: "jwk" }),
    publicKey: createPublicKey({ key: JSON.parse(publicJwk), format: "jwk" }),
  })
}

export function unwrapSessionKey(identity: StoredDeviceIdentity, wrapped: WrappedKey): string {
  if (wrapped.wrapAlgorithm !== ALGORITHM) throw new Error("Unsupported session key wrapping")
  const envelope = JSON.parse(wrapped.wrappedKey) as { v: number; alg: string; iv: string; ciphertext: string; aad: string }
  if (envelope.v !== 1 || envelope.alg !== ALGORITHM) throw new Error("Unsupported session key envelope")
  const ciphertext = Buffer.from(envelope.ciphertext, "base64")
  const decipher = createDecipheriv("aes-256-gcm", wrapKey(identity, wrapped.senderPublicKeyJwk), Buffer.from(envelope.iv, "base64"))
  decipher.setAAD(Buffer.from(envelope.aad, "base64"))
  decipher.setAuthTag(ciphertext.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()])
  if (plaintext.length !== 32) throw new Error("Invalid session key length")
  return plaintext.toString("base64")
}

export function wrapSessionKey(identity: StoredDeviceIdentity, publicJwk: string, key: string): WrappedKey {
  const iv = randomBytes(12)
  const aad = Buffer.from(JSON.stringify({ v: 1, alg: ALGORITHM, senderIdentityKey: identity.identityKey, senderFingerprint: identity.fingerprint }))
  const cipher = createCipheriv("aes-256-gcm", wrapKey(identity, publicJwk), iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(key, "base64")), cipher.final(), cipher.getAuthTag()])
  return {
    wrappedKey: JSON.stringify({ v: 1, alg: ALGORITHM, iv: iv.toString("base64"), aad: aad.toString("base64"), ciphertext: ciphertext.toString("base64") }),
    senderPublicKeyJwk: JSON.stringify(identity.publicKeyJwk),
    wrapAlgorithm: ALGORITHM,
  }
}
