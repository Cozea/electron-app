/**
 * Integration Encryption Keys Management
 *
 * Handles secure storage of per-organization encryption keys using
 * Electron's safeStorage API (backed by OS keychain).
 *
 * These keys are used to encrypt integration credentials before
 * storing them in Convex. The actual credentials are encrypted
 * client-side, so Convex never sees plaintext credentials.
 */

import { app, safeStorage } from 'electron'
import { randomUUID, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// Directory for storing encrypted keys
const KEYS_DIR_NAME = 'integration-keys'

/**
 * Get the directory path for storing encrypted keys
 */
function getKeysDirectory(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, KEYS_DIR_NAME)
}

/**
 * Get the file path for a specific key
 */
function getKeyFilePath(keyId: string): string {
  return path.join(getKeysDirectory(), `${keyId}.key`)
}

/**
 * Ensure the keys directory exists
 */
function ensureKeysDirectory(): void {
  const keysDir = getKeysDirectory()
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true })
  }
}

/**
 * Check if encryption is available on this system
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Generate a new encryption key for an organization
 *
 * @returns Object with keyId and the key data (hex-encoded 256-bit key)
 */
export function generateEncryptionKey(): { keyId: string; keyData: string } {
  // Generate a random 256-bit key (32 bytes)
  const keyBytes = randomBytes(32)
  const keyData = keyBytes.toString('hex') // 64 character hex string

  // Generate a unique ID for this key
  const keyId = randomUUID()

  return { keyId, keyData }
}

/**
 * Store an encryption key securely in the OS keychain
 *
 * @param keyId - Unique identifier for the key
 * @param keyData - The key data to store (hex-encoded)
 * @returns Success status and any error message
 */
export function storeEncryptionKey(
  keyId: string,
  keyData: string
): { success: boolean; error?: string } {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        success: false,
        error: 'Encryption is not available on this system. Please ensure your OS keychain is properly configured.',
      }
    }

    // Validate key format (should be 64 hex characters = 32 bytes)
    if (!/^[0-9a-f]{64}$/i.test(keyData)) {
      return {
        success: false,
        error: 'Invalid key format. Key must be a 64-character hex string.',
      }
    }

    ensureKeysDirectory()

    // Encrypt the key using OS keychain
    const encryptedKey = safeStorage.encryptString(keyData)

    // Write to file
    const keyPath = getKeyFilePath(keyId)
    fs.writeFileSync(keyPath, encryptedKey)

    return { success: true }
  } catch (err) {
    console.error('Failed to store encryption key:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to store encryption key',
    }
  }
}

/**
 * Retrieve an encryption key from the OS keychain
 *
 * @param keyId - Unique identifier for the key
 * @returns The key data (hex-encoded) or error
 */
export function getEncryptionKey(
  keyId: string
): { success: boolean; keyData?: string; error?: string } {
  try {
    const keyPath = getKeyFilePath(keyId)

    if (!fs.existsSync(keyPath)) {
      return {
        success: false,
        error: `Key not found: ${keyId}`,
      }
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return {
        success: false,
        error: 'Encryption is not available on this system.',
      }
    }

    // Read and decrypt
    const encryptedKey = fs.readFileSync(keyPath)
    const keyData = safeStorage.decryptString(encryptedKey)

    return { success: true, keyData }
  } catch (err) {
    console.error('Failed to retrieve encryption key:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve encryption key',
    }
  }
}

/**
 * Delete an encryption key from the OS keychain
 *
 * @param keyId - Unique identifier for the key to delete
 * @returns Success status
 */
export function deleteEncryptionKey(
  keyId: string
): { success: boolean; error?: string } {
  try {
    const keyPath = getKeyFilePath(keyId)

    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath)
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to delete encryption key:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete encryption key',
    }
  }
}

/**
 * Check if a key exists in the keychain
 *
 * @param keyId - Unique identifier for the key
 * @returns Whether the key exists
 */
export function keyExists(keyId: string): boolean {
  const keyPath = getKeyFilePath(keyId)
  return fs.existsSync(keyPath)
}

/**
 * List all stored key IDs
 * (Useful for debugging/admin, returns just IDs not actual keys)
 */
export function listKeyIds(): string[] {
  try {
    const keysDir = getKeysDirectory()
    if (!fs.existsSync(keysDir)) {
      return []
    }

    return fs
      .readdirSync(keysDir)
      .filter((file) => file.endsWith('.key'))
      .map((file) => file.replace('.key', ''))
  } catch (err) {
    console.error('Failed to list key IDs:', err)
    return []
  }
}
