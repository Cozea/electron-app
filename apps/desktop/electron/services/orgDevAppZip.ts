import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib"

import { ORG_DEVAPP_ARTIFACT_LIMITS } from "../../../../shared/orgDevAppLimits"

export { ORG_DEVAPP_ARTIFACT_LIMITS } from "../../../../shared/orgDevAppLimits"

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50

function walkFiles(rootDir: string): string[] {
  const files: string[] = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "." || entry.name === "..") continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error("The DevApp build output cannot contain symbolic links.")
      }
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
      if (files.length > ORG_DEVAPP_ARTIFACT_LIMITS.maxEntries) {
        throw new Error(`The DevApp artifact contains more than ${ORG_DEVAPP_ARTIFACT_LIMITS.maxEntries} files.`)
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function toZipPath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/")
}

export function packDirectoryToZip(rootDir: string): { zip: Buffer; contentHash: string } {
  const files = walkFiles(rootDir)
  if (files.length === 0) {
    throw new Error("The build output is empty.")
  }

  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  let expandedBytes = 0

  for (const filePath of files) {
    const rel = toZipPath(rootDir, filePath)
    const nameBuf = Buffer.from(rel, "utf8")
    if (nameBuf.length === 0 || nameBuf.length > ORG_DEVAPP_ARTIFACT_LIMITS.maxPathBytes) {
      throw new Error("The DevApp artifact contains a path that is too long.")
    }
    const fileSize = fs.statSync(filePath).size
    if (fileSize > ORG_DEVAPP_ARTIFACT_LIMITS.maxEntryBytes) {
      throw new Error(`The DevApp artifact contains a file larger than ${ORG_DEVAPP_ARTIFACT_LIMITS.maxEntryBytes / 1024 / 1024} MB.`)
    }
    expandedBytes += fileSize
    if (expandedBytes > ORG_DEVAPP_ARTIFACT_LIMITS.maxExpandedBytes) {
      throw new Error(`The DevApp artifact expands beyond ${ORG_DEVAPP_ARTIFACT_LIMITS.maxExpandedBytes / 1024 / 1024} MB.`)
    }
    const data = fs.readFileSync(filePath)
    const crc = crc32(data)
    const compressed = deflateRawSync(data)
    const useStore = compressed.length >= data.length
    const payload = useStore ? data : compressed
    const method = useStore ? 0 : 8

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_HEADER, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc >>> 0, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const local = Buffer.concat([localHeader, nameBuf, payload])
    localParts.push(local)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    centralParts.push(Buffer.concat([central, nameBuf]))
    offset += local.length
    if (offset > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes) {
      throw new Error(`The compressed DevApp artifact exceeds ${ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes / 1024 / 1024} MB.`)
    }
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  const zip = Buffer.concat([...localParts, centralBuf, eocd])
  if (zip.length > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes) {
    throw new Error(`The compressed DevApp artifact exceeds ${ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes / 1024 / 1024} MB.`)
  }
  return {
    zip,
    contentHash: createHash("sha256").update(zip).digest("hex"),
  }
}

function findEocdOffset(buffer: Buffer): number {
  if (buffer.length < 22 || buffer.length > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressedBytes) {
    throw new Error("The DevApp artifact is not a valid bounded zip.")
  }
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      return i
    }
  }
  throw new Error("The DevApp artifact is not a valid zip.")
}

function safeJoin(rootDir: string, zipPath: string): string {
  const normalized = zipPath.replace(/\\/g, "/").replace(/^\/+/, "")
  const segments = normalized.split("/")
  if (
    !normalized ||
    normalized.includes("\0") ||
    Buffer.byteLength(normalized, "utf8") > ORG_DEVAPP_ARTIFACT_LIMITS.maxPathBytes ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("The DevApp artifact contains an unsafe path.")
  }
  const fullPath = path.normalize(path.join(rootDir, normalized))
  const root = path.resolve(rootDir) + path.sep
  if (fullPath !== path.resolve(rootDir) && !fullPath.startsWith(root)) {
    throw new Error("The DevApp artifact contains an unsafe path.")
  }
  return fullPath
}

export function unpackZip(zip: Buffer, destinationDir: string): void {
  const eocd = findEocdOffset(zip)
  const entryCount = zip.readUInt16LE(eocd + 10)
  if (entryCount === 0 || entryCount > ORG_DEVAPP_ARTIFACT_LIMITS.maxEntries) {
    throw new Error("The DevApp artifact contains an invalid number of files.")
  }
  let offset = zip.readUInt32LE(eocd + 16)
  if (offset < 0 || offset >= eocd) {
    throw new Error("The DevApp artifact has an invalid directory.")
  }
  let expandedBytes = 0
  const extractedPaths = new Set<string>()

  fs.mkdirSync(destinationDir, { recursive: true })

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > eocd) {
      throw new Error("The DevApp artifact has a truncated directory.")
    }
    if (zip.readUInt32LE(offset) !== CENTRAL_HEADER) {
      throw new Error("The DevApp artifact is not a valid zip.")
    }
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const uncompressedSize = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const expectedCrc = zip.readUInt32LE(offset + 16)
    if (nameLength === 0 || nameLength > ORG_DEVAPP_ARTIFACT_LIMITS.maxPathBytes) {
      throw new Error("The DevApp artifact contains an invalid path.")
    }
    if (offset + 46 + nameLength + extraLength + commentLength > eocd) {
      throw new Error("The DevApp artifact has a truncated directory entry.")
    }
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
    offset += 46 + nameLength + extraLength + commentLength

    if (uncompressedSize > ORG_DEVAPP_ARTIFACT_LIMITS.maxEntryBytes) {
      throw new Error("The DevApp artifact contains a file that is too large.")
    }
    expandedBytes += uncompressedSize
    if (expandedBytes > ORG_DEVAPP_ARTIFACT_LIMITS.maxExpandedBytes) {
      throw new Error("The DevApp artifact expands beyond the allowed size.")
    }
    if (
      compressedSize > 0 &&
      uncompressedSize / compressedSize > ORG_DEVAPP_ARTIFACT_LIMITS.maxCompressionRatio
    ) {
      throw new Error("The DevApp artifact contains a suspicious compression ratio.")
    }

    if (name.endsWith("/")) {
      fs.mkdirSync(safeJoin(destinationDir, name), { recursive: true })
      continue
    }

    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error("The DevApp artifact is not a valid zip.")
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart < 0 || dataStart + compressedSize > zip.length) {
      throw new Error("The DevApp artifact contains truncated file data.")
    }
    const compressed = zip.subarray(dataStart, dataStart + compressedSize)
    const data =
      method === 0
        ? compressed
        : method === 8
          ? inflateRawSync(compressed, {
              maxOutputLength: Math.min(
                ORG_DEVAPP_ARTIFACT_LIMITS.maxEntryBytes + 1,
                uncompressedSize + 1,
              ),
            })
          : null
    if (!data || data.length !== uncompressedSize || (crc32(data) >>> 0) !== expectedCrc) {
      throw new Error("The DevApp artifact could not be unpacked.")
    }

    const outputPath = safeJoin(destinationDir, name)
    const pathKey = path.resolve(outputPath).normalize("NFC").toLowerCase()
    if (extractedPaths.has(pathKey)) {
      throw new Error("The DevApp artifact contains duplicate file paths.")
    }
    extractedPaths.add(pathKey)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, data)
  }
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}
