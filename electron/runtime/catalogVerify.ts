import { createHash, createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'

export interface VerifyCatalogOptions {
  payloadPath: string
  signaturePath: string
  expectedSha256?: string
  publicKeyPem: string
}

export interface VerifyCatalogResult {
  valid: boolean
  sha256?: string
  error?: string
}

function hashFileSha256(filePath: string): string {
  const data = fs.readFileSync(filePath)
  return createHash('sha256').update(data).digest('hex')
}

export function verifyCatalogAsset(options: VerifyCatalogOptions): VerifyCatalogResult {
  try {
    if (!fs.existsSync(options.payloadPath)) {
      return { valid: false, error: 'Catalog payload not found.' }
    }
    if (!fs.existsSync(options.signaturePath)) {
      return { valid: false, error: 'Catalog signature not found.' }
    }

    const payload = fs.readFileSync(options.payloadPath)
    const signature = fs.readFileSync(options.signaturePath)
    const sha256 = hashFileSha256(options.payloadPath)

    if (options.expectedSha256 && options.expectedSha256 !== sha256) {
      return { valid: false, sha256, error: 'Catalog SHA256 mismatch.' }
    }

    const key = createPublicKey(options.publicKeyPem)
    const valid = verify(null, payload, key, signature)
    if (!valid) {
      return { valid: false, sha256, error: 'Catalog signature verification failed.' }
    }

    return { valid: true, sha256 }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Catalog verification failed.',
    }
  }
}

