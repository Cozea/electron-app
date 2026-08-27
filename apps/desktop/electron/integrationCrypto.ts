/**
 * Integration Credentials Encryption/Decryption
 *
 * Provides AES-256-GCM authenticated encryption for integration credentials.
 * Credentials are encrypted client-side before being stored in Convex,
 * ensuring Convex never sees plaintext credentials.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits for GCM
const AUTH_TAG_LENGTH = 16 // 128 bits

/**
 * Convert a hex string to Buffer
 */
function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

/**
 * Convert Buffer to hex string
 */
function bufferToHex(buffer: Buffer): string {
  return buffer.toString('hex')
}

/**
 * Encrypt credentials using AES-256-GCM
 *
 * @param credentials - The credentials object to encrypt
 * @param keyHex - The encryption key as a 64-character hex string
 * @returns Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 */
export function encryptCredentials(
  credentials: Record<string, unknown>,
  keyHex: string
): { success: boolean; encrypted?: string; error?: string } {
  try {
    // Validate key format
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      return {
        success: false,
        error: 'Invalid key format. Key must be a 64-character hex string (32 bytes).',
      }
    }

    const key = hexToBuffer(keyHex)

    // Generate random IV
    const iv = randomBytes(IV_LENGTH)

    // Create cipher
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    })

    // Encrypt
    const plaintext = JSON.stringify(credentials)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])

    // Get auth tag
    const authTag = cipher.getAuthTag()

    // Format: iv:authTag:ciphertext
    const encrypted = `${bufferToHex(iv)}:${bufferToHex(authTag)}:${bufferToHex(ciphertext)}`

    return { success: true, encrypted }
  } catch (err) {
    console.error('Encryption failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Encryption failed',
    }
  }
}

/**
 * Decrypt credentials using AES-256-GCM
 *
 * @param encrypted - Encrypted string in format "iv:authTag:ciphertext"
 * @param keyHex - The encryption key as a 64-character hex string
 * @returns Decrypted credentials object
 */
export function decryptCredentials(
  encrypted: string,
  keyHex: string
): { success: boolean; credentials?: Record<string, unknown>; error?: string } {
  try {
    // Validate key format
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      return {
        success: false,
        error: 'Invalid key format. Key must be a 64-character hex string (32 bytes).',
      }
    }

    // Parse encrypted format
    const parts = encrypted.split(':')
    if (parts.length !== 3) {
      return {
        success: false,
        error: 'Invalid encrypted format. Expected iv:authTag:ciphertext',
      }
    }

    const [ivHex, authTagHex, ciphertextHex] = parts

    // Validate parts
    if (ivHex.length !== IV_LENGTH * 2) {
      return {
        success: false,
        error: `Invalid IV length. Expected ${IV_LENGTH * 2} hex chars, got ${ivHex.length}`,
      }
    }
    if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
      return {
        success: false,
        error: `Invalid auth tag length. Expected ${AUTH_TAG_LENGTH * 2} hex chars, got ${authTagHex.length}`,
      }
    }

    const key = hexToBuffer(keyHex)
    const iv = hexToBuffer(ivHex)
    const authTag = hexToBuffer(authTagHex)
    const ciphertext = hexToBuffer(ciphertextHex)

    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    })
    decipher.setAuthTag(authTag)

    // Decrypt
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    const credentials = JSON.parse(plaintext.toString('utf8'))

    return { success: true, credentials }
  } catch (err) {
    console.error('Decryption failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Decryption failed. Key may be incorrect or data corrupted.',
    }
  }
}

/**
 * Check if a value appears to be encrypted (matches our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false
  }

  const parts = value.split(':')
  if (parts.length !== 3) {
    return false
  }

  const [ivHex, authTagHex, ciphertextHex] = parts

  // IV should be 24 hex chars (12 bytes)
  // Auth tag should be 32 hex chars (16 bytes)
  // Ciphertext should be non-empty hex
  return (
    ivHex.length === IV_LENGTH * 2 &&
    authTagHex.length === AUTH_TAG_LENGTH * 2 &&
    ciphertextHex.length > 0 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    /^[0-9a-f]+$/i.test(authTagHex) &&
    /^[0-9a-f]+$/i.test(ciphertextHex)
  )
}

/**
 * Re-encrypt credentials with a new key (for key rotation)
 *
 * @param encrypted - Currently encrypted string
 * @param oldKeyHex - The old encryption key
 * @param newKeyHex - The new encryption key
 * @returns Re-encrypted string with new key
 */
export function reEncryptCredentials(
  encrypted: string,
  oldKeyHex: string,
  newKeyHex: string
): { success: boolean; encrypted?: string; error?: string } {
  // Decrypt with old key
  const decryptResult = decryptCredentials(encrypted, oldKeyHex)
  if (!decryptResult.success || !decryptResult.credentials) {
    return {
      success: false,
      error: decryptResult.error || 'Failed to decrypt with old key',
    }
  }

  // Re-encrypt with new key
  return encryptCredentials(decryptResult.credentials, newKeyHex)
}
