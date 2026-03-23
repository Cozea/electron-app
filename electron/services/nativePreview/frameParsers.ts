import { Buffer } from 'node:buffer'

export class JpegFrameParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer, onFrame: (frame: Buffer) => void): void {
    if (!chunk.length) return

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk)

    while (true) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]))
      if (start === -1) {
        this.buffer = Buffer.alloc(0)
        return
      }

      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2)
      if (end === -1) {
        if (start > 0) {
          this.buffer = this.buffer.subarray(start)
        }
        return
      }

      const frame = this.buffer.subarray(start, end + 2)
      this.buffer = this.buffer.subarray(end + 2)
      onFrame(Buffer.from(frame))
    }
  }
}

export class LengthPrefixedFrameParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer, onFrame: (frame: Buffer) => void): void {
    if (!chunk.length) return

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk)

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0)
      if (this.buffer.length < frameLength + 4) {
        return
      }

      const frame = this.buffer.subarray(4, 4 + frameLength)
      this.buffer = this.buffer.subarray(4 + frameLength)
      onFrame(Buffer.from(frame))
    }
  }
}

export class JsonObjectStreamParser {
  private buffer = ''

  push(chunk: Buffer, onObject: (payload: string) => void): void {
    if (!chunk.length) return

    this.buffer += chunk.toString('utf8')

    let depth = 0
    let start = -1
    let lastConsumed = 0
    let inString = false
    let escaping = false

    for (let index = 0; index < this.buffer.length; index += 1) {
      const char = this.buffer[index]

      if (inString) {
        if (escaping) {
          escaping = false
          continue
        }

        if (char === '\\') {
          escaping = true
          continue
        }

        if (char === '"') {
          inString = false
        }

        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{') {
        if (depth === 0) {
          start = index
        }
        depth += 1
        continue
      }

      if (char === '}') {
        if (depth === 0) {
          continue
        }

        depth -= 1
        if (depth === 0 && start !== -1) {
          onObject(this.buffer.slice(start, index + 1))
          lastConsumed = index + 1
          start = -1
        }
      }
    }

    if (lastConsumed > 0) {
      this.buffer = this.buffer.slice(lastConsumed)
      return
    }

    if (start > 0) {
      this.buffer = this.buffer.slice(start)
    } else if (depth === 0 && this.buffer.length > 8192) {
      this.buffer = this.buffer.slice(-4096)
    }
  }
}

export class Mp4BoxStreamParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer, onBox: (type: string, data: Buffer) => void): void {
    if (!chunk.length) return

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk)

    while (this.buffer.length >= 8) {
      let boxSize = this.buffer.readUInt32BE(0)
      let headerSize = 8

      if (boxSize === 1) {
        if (this.buffer.length < 16) {
          return
        }

        const largeSize = this.buffer.readBigUInt64BE(8)
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Encountered an MP4 box larger than the supported safe integer range.')
        }

        boxSize = Number(largeSize)
        headerSize = 16
      } else if (boxSize === 0) {
        return
      }

      if (boxSize < headerSize) {
        throw new Error('Encountered an invalid MP4 box size while parsing the native preview stream.')
      }

      if (this.buffer.length < boxSize) {
        return
      }

      const type = this.buffer.toString('ascii', 4, 8)
      const box = this.buffer.subarray(0, boxSize)
      this.buffer = this.buffer.subarray(boxSize)
      onBox(type, Buffer.from(box))
    }
  }
}
