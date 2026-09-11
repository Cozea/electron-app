import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export interface GitProcessHealth {
  available: boolean
  executablePath: string
  gitVersion: string
  lfsAvailable: boolean
  lfsVersion?: string
  supportsPorcelainV2: boolean
  supportsMergeTreeWriteTree: boolean
  supportsZdiff3: boolean
  error?: string
}

export interface GitExecuteOptions {
  cwd: string
  env?: Record<string, string>
  stdin?: string | Buffer
  timeoutMs?: number
  maxBuffer?: number
  allowNonZeroExit?: boolean
}

export interface GitProcessResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutBuffer: Buffer
  stderrBuffer: Buffer
}

export class GitProcess {
  private readonly explicitPath?: string
  private cachedHealth: GitProcessHealth | null = null

  constructor(explicitPath?: string) {
    this.explicitPath = explicitPath ?? process.env.COZEA_GIT_EXECUTABLE
  }

  resolveExecutablePath(): string {
    if (this.explicitPath) {
      const resolved = path.resolve(this.explicitPath)
      if (fs.existsSync(resolved)) {
        return resolved
      }
    }
    return "git"
  }

  async getHealth(forceRefresh = false): Promise<GitProcessHealth> {
    if (this.cachedHealth && !forceRefresh) {
      return this.cachedHealth
    }

    const execPath = this.resolveExecutablePath()
    try {
      const verRes = await this.execute(["--version"], { cwd: process.cwd() })
      if (!verRes.success) {
        throw new Error(`git --version failed with exit code ${verRes.exitCode}: ${verRes.stderr}`)
      }

      const gitVersion = verRes.stdout.trim().replace(/^git version\s*/i, "")

      // Check Git LFS
      let lfsAvailable = false
      let lfsVersion: string | undefined
      try {
        const lfsRes = await this.execute(["lfs", "version"], { cwd: process.cwd() })
        if (lfsRes.success) {
          lfsAvailable = true
          lfsVersion = lfsRes.stdout.trim()
        }
      } catch {
        // LFS optional/not in PATH
      }

      // Check feature support
      const [vMajor, vMinor] = this.parseVersionNumbers(gitVersion)
      const supportsPorcelainV2 = vMajor > 2 || (vMajor === 2 && vMinor >= 11)
      const supportsMergeTreeWriteTree = vMajor > 2 || (vMajor === 2 && vMinor >= 38)
      const supportsZdiff3 = vMajor > 2 || (vMajor === 2 && vMinor >= 35)

      this.cachedHealth = {
        available: true,
        executablePath: execPath,
        gitVersion,
        lfsAvailable,
        lfsVersion,
        supportsPorcelainV2,
        supportsMergeTreeWriteTree,
        supportsZdiff3,
      }
      return this.cachedHealth
    } catch (err: any) {
      this.cachedHealth = {
        available: false,
        executablePath: execPath,
        gitVersion: "unknown",
        lfsAvailable: false,
        supportsPorcelainV2: false,
        supportsMergeTreeWriteTree: false,
        supportsZdiff3: false,
        error: err.message,
      }
      return this.cachedHealth
    }
  }

  private parseVersionNumbers(ver: string): [number, number] {
    const match = ver.match(/(\d+)\.(\d+)/)
    if (match) {
      return [Number(match[1]), Number(match[2])]
    }
    return [0, 0]
  }

  async execute(args: string[], options: GitExecuteOptions): Promise<GitProcessResult> {
    const execPath = this.resolveExecutablePath()
    const timeout = options.timeoutMs ?? 30_000

    return new Promise<GitProcessResult>((resolve, reject) => {
      const gitEnv: NodeJS.ProcessEnv = {
        ...process.env,
        // Enforce non-interactive credential prompts (Section 17.4)
        GIT_TERMINAL_PROMPT: "0",
        // Enforce standard machine-readable locale
        LC_ALL: "C",
        LANG: "C",
        ...options.env,
      }

      const proc = spawn(execPath, args, {
        cwd: options.cwd,
        env: gitEnv,
        stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let totalBytes = 0
      const maxBuffer = options.maxBuffer ?? 50 * 1024 * 1024 // 50MB
      let killedForMaxBuffer = false

      let timer: NodeJS.Timeout | null = setTimeout(() => {
        timer = null
        proc.kill("SIGKILL")
        reject(new Error(`Git command 'git ${args.join(" ")}' timed out after ${timeout}ms`))
      }, timeout)

      proc.stdout?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > maxBuffer && !killedForMaxBuffer) {
          killedForMaxBuffer = true
          proc.kill("SIGKILL")
          reject(new Error(`Git command output exceeded maxBuffer of ${maxBuffer} bytes`))
          return
        }
        stdoutChunks.push(chunk)
      })

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer)
        if (killedForMaxBuffer) return

        const stdoutBuffer = Buffer.concat(stdoutChunks)
        const stderrBuffer = Buffer.concat(stderrChunks)
        const stdout = stdoutBuffer.toString("utf8")
        const stderr = stderrBuffer.toString("utf8")

        const success = code === 0
        if (!success && !options.allowNonZeroExit) {
          // If non-zero is not allowed, reject with informative error
          const err = new Error(
            `Git command 'git ${args[0]}' failed with exit code ${code}:\n${stderr || stdout}`,
          )
          ;(err as any).exitCode = code
          ;(err as any).stderr = stderr
          ;(err as any).stdout = stdout
          reject(err)
          return
        }

        resolve({
          success,
          exitCode: code,
          stdout,
          stderr,
          stdoutBuffer,
          stderrBuffer,
        })
      })

      if (options.stdin && proc.stdin) {
        if (typeof options.stdin === "string") {
          proc.stdin.write(options.stdin)
        } else {
          proc.stdin.write(options.stdin)
        }
        proc.stdin.end()
      }
    })
  }
}
