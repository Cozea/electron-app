import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { getProjectdSocketPath } from "@cozea/projectd-protocol"

/**
 * Runs the helper with optional stdin. Secrets travel on stdin because argv is
 * readable by every local process through the process list.
 */
function runHelperProcess(helperPath: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(helperPath, args, { maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr })
        return
      }
      // The helper prints a JSON error reply before exiting non-zero; surface its message.
      try {
        const reply = JSON.parse(stdout.trim()) as { error?: string }
        if (reply.error) {
          reject(new Error(reply.error))
          return
        }
      } catch {
        // Not a helper reply
      }
      reject(error)
    })
    child.stdin?.on("error", () => {
      // The execFile callback reports an early helper exit; don't emit EPIPE.
    })
    child.stdin?.end(input ?? "")
  })
}

export interface VolumeCapabilitiesResult {
  path: string
  isCaseSensitive: boolean
  supportsCloning: boolean
  fileSystemType: string
}

export interface LaunchAgentStatusResult {
  plistName: string
  status: "enabled" | "disabled" | "not_registered" | "requires_approval" | "not_found" | "running"
  plistPath: string | null
  isLoaded: boolean
}

export class NativeMacHelper {
  readonly helperPath: string

  constructor(customPath?: string) {
    if (customPath) {
      this.helperPath = customPath
      return
    }

    if (process.env.COZEA_MAC_HELPER_PATH) {
      this.helperPath = process.env.COZEA_MAC_HELPER_PATH
      return
    }

    // Default development build locations
    const candidatePaths = [
      path.resolve(__dirname, "../../../native/projectd-macos/.build/debug/cozea-projectd-mac-helper"),
      path.resolve(__dirname, "../../../native/projectd-macos/.build/release/cozea-projectd-mac-helper"),
      path.resolve(process.cwd(), "native/projectd-macos/.build/debug/cozea-projectd-mac-helper"),
      path.resolve(process.cwd(), "native/projectd-macos/.build/release/cozea-projectd-mac-helper"),
    ]

    const found = candidatePaths.find((p) => fs.existsSync(p))
    this.helperPath = found ?? candidatePaths[0]
  }

  get isAvailable(): boolean {
    return process.platform === "darwin" && fs.existsSync(this.helperPath)
  }

  private async runCommand(args: string[], input?: string): Promise<any> {
    if (!this.isAvailable) {
      throw new Error(`native macOS helper not found at '${this.helperPath}'`)
    }

    const { stdout, stderr } = await runHelperProcess(this.helperPath, args, input)
    const trimmed = stdout.trim()
    if (!trimmed) {
      if (stderr) throw new Error(stderr)
      return null
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed.success) {
        throw new Error(parsed.error ?? "Unknown native helper error")
      }
      return parsed.result
    } catch {
      // Keychain replies contain private keys; never include stdout in errors.
      throw new Error("Invalid or unsuccessful native helper reply")
    }
  }

  async saveIdentity(jsonString: string): Promise<void> {
    await this.runCommand(["keychain-save", this.identityAccount], jsonString)
  }

  async loadIdentity(): Promise<string | null> {
    try {
      const res = await this.runCommand(["keychain-load", this.identityAccount])
      return res?.identity ?? null
    } catch (err: any) {
      if (err.message?.includes("not_found") || err.message?.includes("itemNotFound")) {
        return null
      }
      throw err
    }
  }

  async deleteIdentity(): Promise<void> {
    await this.runCommand(["keychain-delete", this.identityAccount])
  }

  private get identityAccount(): string {
    return `device_${createHash("sha256").update(getProjectdSocketPath()).digest("hex")}`
  }

  async signChallenge(challenge: string, privateKeyD: string): Promise<string> {
    const res = await this.runCommand(["sign-challenge", "--challenge", challenge], privateKeyD)
    return res.signature
  }

  async probeVolume(dirPath: string): Promise<VolumeCapabilitiesResult> {
    return this.runCommand(["volume-probe", dirPath])
  }

  async getLaunchAgentStatus(): Promise<LaunchAgentStatusResult> {
    return this.runCommand(["launchagent-status"])
  }

  async registerLaunchAgent(execPath: string, socketPath: string): Promise<void> {
    await this.runCommand([
      "launchagent-register",
      "--exec",
      execPath,
      "--socket",
      socketPath,
    ])
  }

  async unregisterLaunchAgent(): Promise<void> {
    await this.runCommand(["launchagent-unregister"])
  }
}
