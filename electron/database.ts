import { createSign } from 'node:crypto'
import * as integrationCrypto from './integrationCrypto'
import * as integrationKeys from './integrationKeys'

interface SupabaseCredentials {
  url: string
  anonKey: string
}

interface FirebaseServiceAccountCredentials {
  projectId: string
  clientEmail: string
  privateKey: string
}

function base64UrlEncode(value: string | Buffer): string {
  const base64 = (typeof value === 'string' ? Buffer.from(value) : value).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decryptCredentials(encryptedCredentials: string, keyId: string): Record<string, unknown> {
  const keyResult = integrationKeys.getEncryptionKey(keyId)
  if (!keyResult.success || !keyResult.keyData) {
    throw new Error(keyResult.error || 'Failed to retrieve encryption key')
  }

  const decryptResult = integrationCrypto.decryptCredentials(encryptedCredentials, keyResult.keyData)
  if (!decryptResult.success || !decryptResult.credentials) {
    throw new Error(decryptResult.error || 'Failed to decrypt credentials')
  }

  return decryptResult.credentials
}

function coerceString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function getSupabaseCredentials(raw: Record<string, unknown>): SupabaseCredentials {
  const url = coerceString(raw.url, 'Supabase url')
  const anonKey = coerceString(raw.anonKey, 'Supabase anonKey')
  return { url, anonKey }
}

function getFirebaseCredentials(raw: Record<string, unknown>): FirebaseServiceAccountCredentials {
  const projectId = coerceString(raw.projectId, 'Firebase projectId')
  const clientEmail = coerceString(raw.clientEmail, 'Firebase clientEmail')
  const privateKey = coerceString(raw.privateKey, 'Firebase privateKey')
  return { projectId, clientEmail, privateKey }
}

export interface SupabaseSelectOptions {
  table: string
  select?: string
  limit?: number
  offset?: number
  orderBy?: string
  orderAscending?: boolean
  // Either provide raw credentials...
  credentials?: SupabaseCredentials
  // ...or encrypted credentials + keyId
  encryptedCredentials?: string
  keyId?: string
}

export async function supabaseSelect(options: SupabaseSelectOptions): Promise<{ rows: unknown[] }> {
  const limit = typeof options.limit === 'number' ? Math.max(1, Math.min(200, options.limit)) : 50
  const offset = typeof options.offset === 'number' ? Math.max(0, options.offset) : 0
  const select = options.select?.trim() ? options.select.trim() : '*'

  const creds =
    options.credentials ??
    (options.encryptedCredentials && options.keyId
      ? getSupabaseCredentials(decryptCredentials(options.encryptedCredentials, options.keyId))
      : null)

  if (!creds) {
    throw new Error('Missing Supabase credentials (connect Supabase integration or set env vars)')
  }

  const baseUrl = new URL(creds.url)
  const endpoint = new URL(`${baseUrl.origin}/rest/v1/${encodeURIComponent(options.table)}`)
  endpoint.searchParams.set('select', select)
  endpoint.searchParams.set('limit', String(limit))
  if (offset) endpoint.searchParams.set('offset', String(offset))
  if (options.orderBy?.trim()) {
    endpoint.searchParams.set('order', `${options.orderBy}.${options.orderAscending === false ? 'desc' : 'asc'}`)
  }

  const res = await fetch(endpoint.toString(), {
    headers: {
      apikey: creds.anonKey,
      authorization: `Bearer ${creds.anonKey}`,
      accept: 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase request failed (${res.status}): ${text || res.statusText}`)
  }

  const rows = (await res.json()) as unknown
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected Supabase response (expected an array)')
  }

  return { rows }
}

// ---------------------------
// Firestore (Firebase) support
// ---------------------------

type GoogleTokenCacheEntry = { token: string; expiresAtMs: number }
const googleTokenCache = new Map<string, GoogleTokenCacheEntry>()

async function getGoogleAccessToken(creds: FirebaseServiceAccountCredentials): Promise<string> {
  const cacheKey = `${creds.clientEmail}|${creds.projectId}`
  const cached = googleTokenCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAtMs - now > 60_000) {
    return cached.token
  }

  const iat = Math.floor(now / 1000)
  const exp = iat + 60 * 60

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: creds.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp,
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const signature = createSign('RSA-SHA256').update(signingInput).sign(creds.privateKey)
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Google token request failed (${res.status}): ${text || res.statusText}`)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Google token response was not valid JSON')
  }

  const token = (json as { access_token?: unknown }).access_token
  const expiresIn = (json as { expires_in?: unknown }).expires_in

  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Google token response missing access_token')
  }

  const expiresAtMs = now + (typeof expiresIn === 'number' ? expiresIn * 1000 : 55 * 60 * 1000)
  googleTokenCache.set(cacheKey, { token, expiresAtMs })

  return token
}

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== 'object') return null

  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return value.timestampValue
  if ('bytesValue' in value) return value.bytesValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('doubleValue' in value) return value.doubleValue

  if ('integerValue' in value) {
    const asNumber = Number(value.integerValue)
    if (Number.isSafeInteger(asNumber)) return asNumber
    return value.integerValue
  }

  if ('arrayValue' in value) {
    const values = value.arrayValue.values ?? []
    return values.map((v) => decodeFirestoreValue(v))
  }

  if ('mapValue' in value) {
    const fields = value.mapValue.fields ?? {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v)
    return out
  }

  return null
}

function decodeFirestoreDocument(doc: Record<string, unknown>): {
  id: string
  path: string
  createTime?: string
  updateTime?: string
  fields: Record<string, unknown>
} {
  const name = typeof doc.name === 'string' ? doc.name : ''
  const parts = name.split('/').filter(Boolean)
  const id = parts.length ? parts[parts.length - 1] : 'unknown'

  const rawFields = (doc.fields ?? {}) as Record<string, FirestoreValue>
  const fields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawFields)) fields[k] = decodeFirestoreValue(v)

  return {
    id,
    path: name,
    createTime: typeof doc.createTime === 'string' ? doc.createTime : undefined,
    updateTime: typeof doc.updateTime === 'string' ? doc.updateTime : undefined,
    fields,
  }
}

export interface FirestoreListDocumentsOptions {
  collection: string
  pageSize?: number
  pageToken?: string
  encryptedCredentials: string
  keyId: string
}

export async function firestoreListDocuments(
  options: FirestoreListDocumentsOptions
): Promise<{ documents: Array<ReturnType<typeof decodeFirestoreDocument>>; nextPageToken?: string }> {
  const raw = decryptCredentials(options.encryptedCredentials, options.keyId)
  const creds = getFirebaseCredentials(raw)

  const token = await getGoogleAccessToken(creds)
  const pageSize = typeof options.pageSize === 'number' ? Math.max(1, Math.min(200, options.pageSize)) : 50

  const endpoint = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/databases/(default)/documents/${encodeURIComponent(options.collection)}`
  )
  endpoint.searchParams.set('pageSize', String(pageSize))
  if (options.pageToken) endpoint.searchParams.set('pageToken', options.pageToken)

  const res = await fetch(endpoint.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Firestore request failed (${res.status}): ${text || res.statusText}`)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Firestore response was not valid JSON')
  }

  const documentsRaw = (json as { documents?: unknown[] }).documents
  const nextPageToken = (json as { nextPageToken?: unknown }).nextPageToken

  const documents = Array.isArray(documentsRaw)
    ? documentsRaw
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d) => decodeFirestoreDocument(d))
    : []

  return {
    documents,
    nextPageToken: typeof nextPageToken === 'string' ? nextPageToken : undefined,
  }
}

