/**
 * Encryption Utilities for Convex
 *
 * Provides AES-256-GCM authenticated encryption for sensitive data
 * like API keys stored in Convex.
 *
 * The encryption key is stored in Convex environment variables
 * and NEVER exposed to the client.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded)
 */

/**
 * Check if we're running in a Convex function (has access to process.env)
 */
function getEncryptionKey(): string {
  // In Convex, environment variables are accessed via process.env
  // The key must be set in the Convex dashboard under Settings > Environment Variables
  const key = process.env.CONVEX_ENCRYPTION_KEY

  if (!key) {
    throw new Error(
      "CONVEX_ENCRYPTION_KEY environment variable is not set. " +
        "Add it in the Convex dashboard under Settings > Environment Variables."
    )
  }

  if (key.length !== 64) {
    throw new Error(
      "CONVEX_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate one with: openssl rand -hex 32"
    )
  }

  return key
}

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Generate a random IV (initialization vector)
 */
function generateIV(): Uint8Array {
  const iv = new Uint8Array(12) // 96 bits for GCM
  crypto.getRandomValues(iv)
  return iv
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 */
export async function encrypt(plaintext: string): Promise<string> {
  const keyHex = getEncryptionKey()
  const keyBytes = hexToBytes(keyHex)

  // Import the key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  )

  // Generate random IV
  const iv = generateIV()

  // Encode plaintext to bytes
  const encoder = new TextEncoder()
  const plaintextBytes = encoder.encode(plaintext)

  // Encrypt
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    plaintextBytes
  )

  // The result includes the auth tag at the end (16 bytes)
  const resultBytes = new Uint8Array(ciphertextWithTag)
  const ciphertext = resultBytes.slice(0, -16)
  const authTag = resultBytes.slice(-16)

  // Format: iv:authTag:ciphertext
  return `${bytesToHex(iv)}:${bytesToHex(authTag)}:${bytesToHex(ciphertext)}`
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 *
 * @param encrypted - Encrypted string in format "iv:authTag:ciphertext"
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decrypt(encrypted: string): Promise<string> {
  const keyHex = getEncryptionKey()
  const keyBytes = hexToBytes(keyHex)

  // Parse the encrypted format
  const parts = encrypted.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format. Expected iv:authTag:ciphertext")
  }

  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = hexToBytes(ivHex)
  const authTag = hexToBytes(authTagHex)
  const ciphertext = hexToBytes(ciphertextHex)

  // Import the key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  )

  // Combine ciphertext and auth tag (Web Crypto expects them together)
  const combined = new Uint8Array(ciphertext.length + authTag.length)
  combined.set(ciphertext)
  combined.set(authTag, ciphertext.length)

  // Decrypt
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    combined
  )

  // Decode bytes to string
  const decoder = new TextDecoder()
  return decoder.decode(plaintextBytes)
}

/**
 * Check if a value appears to be encrypted (matches our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== "string") {
    return false
  }

  const parts = value.split(":")
  if (parts.length !== 3) {
    return false
  }

  const [ivHex, authTagHex, ciphertextHex] = parts

  // IV should be 24 hex chars (12 bytes)
  // Auth tag should be 32 hex chars (16 bytes)
  // Ciphertext should be non-empty hex
  return (
    ivHex.length === 24 &&
    authTagHex.length === 32 &&
    ciphertextHex.length > 0 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    /^[0-9a-f]+$/i.test(authTagHex) &&
    /^[0-9a-f]+$/i.test(ciphertextHex)
  )
}

/**
 * Encrypt a value only if it's not already encrypted
 */
export async function ensureEncrypted(value: string): Promise<string> {
  if (isEncrypted(value)) {
    return value
  }
  return encrypt(value)
}

/**
 * Safely decrypt a value, returning null if it fails
 */
export async function safeDecrypt(encrypted: string): Promise<string | null> {
  try {
    return await decrypt(encrypted)
  } catch {
    return null
  }
}

/**
 * Mask a key for safe display (show first 4 and last 4 chars)
 */
export function maskKey(key: string): string {
  if (!key || key.length < 12) {
    return "****"
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

/**
 * Validate that a key looks like a valid API key for a provider
 */
export function validateKeyFormat(provider: string, key: string): boolean {
  if (!key || typeof key !== "string") {
    return false
  }

  switch (provider) {
    case "anthropic":
      // Anthropic keys start with "sk-ant-"
      return key.startsWith("sk-ant-") && key.length > 20
    case "openai":
      // OpenAI keys start with "sk-"
      return key.startsWith("sk-") && key.length > 20
    case "google":
      // Google API keys are typically 39 chars
      return key.length >= 30
    default:
      return key.length > 10
  }
}
