import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import readline from "node:readline"

import { NativeMacHelper } from "../native/NativeMacHelper"

export interface NativeFSEventItem {
  id: number
  path: string
  flags: number
  isCreated: boolean
  isRemoved: boolean
  isRenamed: boolean
  isModified: boolean
  isDir: boolean
  isSymlink: boolean
  dropped: boolean
}

export class FSEventsClient extends EventEmitter {
  readonly path: string
  readonly helper: NativeMacHelper
  private proc: ChildProcess | null = null
  private isRunning = false

  constructor(targetPath: string, helper?: NativeMacHelper) {
    super()
    this.path = targetPath
    this.helper = helper ?? new NativeMacHelper()
  }

  get running(): boolean {
    return this.isRunning
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    if (!this.helper.isAvailable) {
      throw new Error(`Native macOS helper not available at ${this.helper.helperPath}`)
    }

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(
        this.helper.helperPath,
        ["fsevents-stream", this.path, "--latency", "0.05"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
      this.proc = proc

      let ready = false

      const rl = readline.createInterface({
        input: proc.stdout!,
        terminal: false,
      })

      rl.on("line", (line) => {
        const trimmed = line.trim()
        if (!trimmed) return

        try {
          const parsed = JSON.parse(trimmed)
          if (parsed.type === "ready") {
            ready = true
            this.isRunning = true
            resolve()
            return
          }

          if (parsed.type === "events" && Array.isArray(parsed.items)) {
            const items = parsed.items as NativeFSEventItem[]
            const hasDropped = items.some((item) => item.dropped)
            if (hasDropped) {
              this.emit("dropped", "Kernel or user event buffer dropped")
            }
            this.emit("events", items)
          }
        } catch (err) {
          console.warn("[FSEventsClient] Failed to parse output line:", trimmed, err)
        }
      })

      proc.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString("utf8")
        console.warn("[FSEventsClient stderr]", msg)
      })

      proc.on("error", (err) => {
        if (!ready) reject(err)
        this.emit("error", err)
      })

      proc.on("close", (code) => {
        this.isRunning = false
        this.proc = null
        if (!ready) {
          reject(new Error(`FSEvents process closed prematurely with code ${code}`))
        } else {
          this.emit("close", code)
        }
      })
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.stdin?.write("stop\n")
      this.proc.kill("SIGTERM")
      this.proc = null
    }
    this.isRunning = false
  }
}
