import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

export interface LocalSessionCipherOptions {
  sessionId: string
  roomKey: Uint8Array
  roomKeyVersion?: number
  previousRoomKeys?: Readonly<Record<number, Uint8Array>>
}

/** Domain-separated local storage encryption; old generations remain readable. */
export class LocalSessionCipher {
  readonly sessionId: string
  readonly version: number
  private readonly keys = new Map<number, Buffer>()

  constructor(options: LocalSessionCipherOptions) {
    this.sessionId = options.sessionId
    this.version = options.roomKeyVersion ?? 1
    for (const [version, key] of Object.entries(options.previousRoomKeys ?? {})) {
      this.addKey(Number(version), key)
    }
    this.addKey(this.version, options.roomKey)
  }

  private addKey(version: number, key: Uint8Array): void {
    if (!Number.isSafeInteger(version) || version < 1 || version > 0xffffffff || key.byteLength !== 32) {
      throw new Error("Invalid local session storage key")
    }
    this.keys.set(version, Buffer.from(hkdfSync("sha256", key, this.sessionId,
      "cozea-projectd-local-session-storage-v1", 32)))
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(12)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(this.version)
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.version)!, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([1, this.sessionId, this.version, context])))
    const bytes = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    return `czenc1:${Buffer.concat([header, iv, cipher.getAuthTag(), bytes]).toString("base64")}`
  }

  open(envelope: string, context: string): string {
    if (!envelope.startsWith("czenc1:")) throw new Error("Local session record is not encrypted")
    const bytes = Buffer.from(envelope.slice(7), "base64")
    if (bytes.length < 32) throw new Error("Invalid local session envelope")
    const version = bytes.readUInt32BE(0)
    const key = this.keys.get(version)
    if (!key) throw new Error(`Local session recovery needs key generation ${version}`)
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16))
    decipher.setAuthTag(bytes.subarray(16, 32))
    decipher.setAAD(Buffer.from(JSON.stringify([1, this.sessionId, version, context])))
    return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]).toString("utf8")
  }
}
