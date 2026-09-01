import {
  devAppRuntimeAttestationPayload,
  selectDevAppRuntimeImage,
  validateDevAppRuntimeReleaseImage,
  type DevAppRuntimeIdentity,
  type DevAppRuntimeReleaseImage,
} from '../../../../shared/devAppContainedRuntime'

const MAX_CLOCK_SKEW_MS = 5 * 60_000
const toBufferSource = (value: Uint8Array): BufferSource => value as unknown as BufferSource

function pemBytes(value: string): Uint8Array {
  const match = value.trim().match(/^-----BEGIN PUBLIC KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PUBLIC KEY-----$/)
  if (!match) throw new Error('The trusted DevApp builder public key is invalid')
  const canonical = match[1]!.replace(/\s/g, '')
  const binary = atob(canonical)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64Bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('The DevApp image signature is not canonical base64')
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  let roundTrip = ''
  for (const byte of bytes) roundTrip += String.fromCharCode(byte)
  if (!bytes.length || btoa(roundTrip) !== value) throw new Error('The DevApp image signature is invalid')
  return bytes
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Verifies both the immutable release statement and its Ed25519 builder signature. */
export async function verifyHostedRuntimeImage(
  release: DevAppRuntimeReleaseImage,
  identity: DevAppRuntimeIdentity,
  publicKeyPem: string,
): Promise<ReturnType<typeof selectDevAppRuntimeImage>> {
  const structural = validateDevAppRuntimeReleaseImage(release, {
    sourceDigest: identity.sourceDigest,
    packageManifestDigest: identity.packageManifestDigest,
  })
  if (structural) throw new Error(structural)
  if (
    release.attestation.builtAt > Date.now() + MAX_CLOCK_SKEW_MS ||
    release.attestation.sourceDigest !== identity.sourceDigest ||
    release.attestation.packageManifestDigest !== identity.packageManifestDigest
  ) {
    throw new Error('The DevApp image attestation does not match this immutable release')
  }
  const payload = new TextEncoder().encode(devAppRuntimeAttestationPayload(release.attestation))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  if (`sha256:${hex(digest)}` !== release.attestationDigest) {
    throw new Error('The DevApp image attestation digest does not match its statement')
  }
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toBufferSource(pemBytes(publicKeyPem)),
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    toBufferSource(base64Bytes(release.signature)),
    toBufferSource(payload),
  )
  if (!valid) throw new Error('The DevApp image signature could not be verified')
  return selectDevAppRuntimeImage(release, 'linux/amd64')
}
