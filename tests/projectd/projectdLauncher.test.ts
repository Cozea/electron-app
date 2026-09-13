import { describe, expect, it } from "vitest"

import {
  PROJECTD_LAUNCH_AGENT_LABEL,
  buildLaunchAgentPlist,
  ensureProjectdRunning,
  planProjectdLaunch,
  type ProjectdLaunchContext,
  type ProjectdLauncherEffects,
} from "../../apps/desktop/electron/projectd/ProjectdLauncher"

/**
 * How the app gets cozea-projectd running: a LaunchAgent in the packaged app, a
 * detached source run in development. launchd, the file system and the daemon are
 * simulated; nothing here touches the real ~/Library/LaunchAgents.
 */

const PACKAGED: ProjectdLaunchContext = {
  platform: "darwin",
  isPackaged: true,
  execPath: "/Applications/Cozea.app/Contents/MacOS/Cozea",
  resourcesPath: "/Applications/Cozea.app/Contents/Resources",
  repoRoot: "/src/electron-app",
  appVersion: "0.2.4",
  homeDir: "/Users/tester",
  tmpDir: "/tmp",
  uid: 501,
  socketPath: "/tmp/cozea-projectd-501.sock",
  env: {},
}
const DEVELOPMENT: ProjectdLaunchContext = { ...PACKAGED, isPackaged: false }
const BUNDLE = "/Applications/Cozea.app/Contents/Resources/projectd/projectd.mjs"
const HELPER = "/Applications/Cozea.app/Contents/Resources/projectd/cozea-projectd-mac-helper"
const SOURCE_ENTRY = "/src/electron-app/apps/projectd/src/main.ts"
const PLIST_PATH = "/Users/tester/Library/LaunchAgents/app.cozea.projectd.plist"
const SERVICE = "gui/501/app.cozea.projectd"

/** A Mac with launchd, a file system and maybe a running daemon. */
class FakeMac implements ProjectdLauncherEffects {
  readonly files = new Map<string, string>()
  readonly present = new Set<string>()
  readonly launchctlCalls: string[][] = []
  readonly spawns: Array<{ command: string; args: string[]; cwd: string }> = []
  readonly logs: string[] = []
  running = false
  agentLoaded = false
  /** Whether loading the agent actually brings up a daemon that answers. */
  daemonStarts = true
  bootstrapFailures = 0
  spawnError: Error | null = null

  constructor(options: { running?: boolean; present?: string[]; files?: Record<string, string>; agentLoaded?: boolean } = {}) {
    this.running = options.running ?? false
    this.agentLoaded = options.agentLoaded ?? false
    for (const filePath of options.present ?? []) this.present.add(filePath)
    for (const [filePath, content] of Object.entries(options.files ?? {})) this.files.set(filePath, content)
  }

  async probe(): Promise<boolean> {
    return this.running
  }

  exists(filePath: string): boolean {
    return this.present.has(filePath) || this.files.has(filePath)
  }

  readFile(filePath: string): string | null {
    return this.files.get(filePath) ?? null
  }

  writeFile(filePath: string, content: string): void {
    this.files.set(filePath, content)
  }

  mkdir(): void {
    // Folders always exist here
  }

  async launchctl(args: string[]): Promise<{ ok: boolean; output: string }> {
    this.launchctlCalls.push(args)
    const [verb] = args
    if (verb === "bootout") {
      const wasLoaded = this.agentLoaded
      this.agentLoaded = false
      this.running = false
      return wasLoaded ? { ok: true, output: "" } : { ok: false, output: "Boot-out failed: 3: No such process" }
    }
    if (verb === "bootstrap") {
      if (this.bootstrapFailures > 0) {
        this.bootstrapFailures -= 1
        return { ok: false, output: "Bootstrap failed: 5: Input/output error" }
      }
      this.agentLoaded = true
      this.running = this.daemonStarts
      return { ok: true, output: "" }
    }
    if (verb === "kickstart") {
      if (!this.agentLoaded) return { ok: false, output: `Could not find service "${PROJECTD_LAUNCH_AGENT_LABEL}"` }
      this.running = this.daemonStarts
      return { ok: true, output: "" }
    }
    return { ok: false, output: `unexpected launchctl ${verb}` }
  }

  async spawnDetached(command: string, args: string[], options: { cwd: string }): Promise<void> {
    if (this.spawnError) throw this.spawnError
    this.spawns.push({ command, args, cwd: options.cwd })
    this.running = this.daemonStarts
  }

  async sleep(): Promise<void> {
    // Time passes instantly
  }

  log(message: string): void {
    this.logs.push(message)
  }
}

function currentAgentPlist(): string {
  const plan = planProjectdLaunch(PACKAGED, (filePath) => filePath === BUNDLE)
  if (plan.kind !== "launch-agent") throw new Error(`expected a launch agent plan, got ${plan.kind}`)
  return plan.plist
}

describe("planning how cozea-projectd starts", () => {
  it("registers the bundled daemon as a LaunchAgent that runs on the app's Electron binary", () => {
    const plan = planProjectdLaunch(PACKAGED, (filePath) => filePath === BUNDLE || filePath === HELPER)
    expect(plan).toMatchObject({ kind: "launch-agent", label: PROJECTD_LAUNCH_AGENT_LABEL, plistPath: PLIST_PATH })
    if (plan.kind !== "launch-agent") return
    expect(plan.plist).toContain(
      `<array>\n    <string>${PACKAGED.execPath}</string>\n    <string>${BUNDLE}</string>\n  </array>`,
    )
    for (const [name, value] of [
      ["ELECTRON_RUN_AS_NODE", "1"],
      ["COZEA_PROJECTD_SOCKET", PACKAGED.socketPath],
      ["COZEA_PROJECTD_APP_VERSION", "0.2.4"],
      ["COZEA_MAC_HELPER_PATH", HELPER],
    ]) {
      expect(plan.plist).toContain(`<key>${name}</key>\n    <string>${value}</string>`)
    }
    expect(plan.plist).toContain("<key>KeepAlive</key>\n  <true/>")
    expect(plan.plist).toContain("<string>/Users/tester/Library/Logs/Cozea/projectd.log</string>")
  })

  it("leaves the helper out when the app does not ship it", () => {
    expect(currentAgentPlist()).not.toContain("COZEA_MAC_HELPER_PATH")
  })

  it("runs the daemon from source in a development checkout", () => {
    expect(planProjectdLaunch(DEVELOPMENT, (filePath) => filePath === SOURCE_ENTRY)).toEqual({
      kind: "spawn",
      command: "bun",
      args: [SOURCE_ENTRY],
      cwd: "/src/electron-app",
      logPath: "/tmp/cozea-projectd-dev.log",
    })
  })

  it("starts nothing when switched off, off macOS, or without a daemon to run", () => {
    const always = () => true
    expect(planProjectdLaunch({ ...PACKAGED, env: { COZEA_PROJECTD_AUTOSTART: "0" } }, always)).toMatchObject({ kind: "skip" })
    expect(planProjectdLaunch({ ...PACKAGED, platform: "win32" }, always)).toMatchObject({ kind: "skip" })
    expect(planProjectdLaunch(PACKAGED, () => false)).toEqual({
      kind: "skip",
      reason: `no projectd bundle at ${BUNDLE}`,
    })
    expect(planProjectdLaunch(DEVELOPMENT, () => false)).toMatchObject({ kind: "skip" })
  })

  it("escapes paths in the agent plist", () => {
    const plist = buildLaunchAgentPlist({
      label: "app.cozea.projectd",
      programArguments: ["/Volumes/R&D <copy>/Cozea"],
      environment: {},
      logPath: "/tmp/log",
    })
    expect(plist).toContain("<string>/Volumes/R&amp;D &lt;copy&gt;/Cozea</string>")
  })
})

describe("getting cozea-projectd running", () => {
  it("does nothing when the current agent's daemon already answers", async () => {
    const mac = new FakeMac({ running: true, agentLoaded: true, present: [BUNDLE], files: { [PLIST_PATH]: currentAgentPlist() } })
    expect(await ensureProjectdRunning(PACKAGED, mac)).toBe("running")
    expect(mac.launchctlCalls).toEqual([])
  })

  it("installs and loads the agent on first launch", async () => {
    const mac = new FakeMac({ present: [BUNDLE] })
    expect(await ensureProjectdRunning(PACKAGED, mac)).toBe("started")
    expect(mac.files.get(PLIST_PATH)).toBe(currentAgentPlist())
    expect(mac.launchctlCalls).toEqual([
      ["bootout", SERVICE],
      ["bootstrap", "gui/501", PLIST_PATH],
    ])
  })

  it("reloads the agent after an app update, which restarts the daemon on the new bundle", async () => {
    const outdated = currentAgentPlist().replace("0.2.4", "0.2.3")
    const mac = new FakeMac({ running: true, agentLoaded: true, present: [BUNDLE], files: { [PLIST_PATH]: outdated } })
    expect(await ensureProjectdRunning(PACKAGED, mac)).toBe("restarted")
    expect(mac.files.get(PLIST_PATH)).toBe(currentAgentPlist())
    expect(mac.launchctlCalls.map(([verb]) => verb)).toEqual(["bootout", "bootstrap"])
  })

  it("restarts a loaded agent whose daemon stopped answering, and loads one launchd lost", async () => {
    const stopped = new FakeMac({ agentLoaded: true, present: [BUNDLE], files: { [PLIST_PATH]: currentAgentPlist() } })
    expect(await ensureProjectdRunning(PACKAGED, stopped)).toBe("started")
    expect(stopped.launchctlCalls).toEqual([["kickstart", "-k", SERVICE]])

    const lost = new FakeMac({ present: [BUNDLE], files: { [PLIST_PATH]: currentAgentPlist() } })
    expect(await ensureProjectdRunning(PACKAGED, lost)).toBe("started")
    expect(lost.launchctlCalls.map(([verb]) => verb)).toEqual(["kickstart", "bootstrap"])
  })

  it("retries a bootstrap launchd refuses right after a bootout, then gives up", async () => {
    const flaky = new FakeMac({ present: [BUNDLE] })
    flaky.bootstrapFailures = 2
    expect(await ensureProjectdRunning(PACKAGED, flaky)).toBe("started")

    const broken = new FakeMac({ present: [BUNDLE] })
    broken.bootstrapFailures = 3
    expect(await ensureProjectdRunning(PACKAGED, broken)).toBe("failed")
    expect(broken.logs.join("\n")).toMatch(/could not load .*Input\/output error/)
  })

  it("reports a daemon that never answers after launchd loads it", async () => {
    const mac = new FakeMac({ present: [BUNDLE] })
    mac.daemonStarts = false
    expect(await ensureProjectdRunning(PACKAGED, mac, 1_000)).toBe("failed")
    expect(mac.logs.join("\n")).toMatch(/did not answer/)
  })

  it("starts the source daemon in development only when nothing answers", async () => {
    const idle = new FakeMac({ present: [SOURCE_ENTRY] })
    expect(await ensureProjectdRunning(DEVELOPMENT, idle)).toBe("started")
    expect(idle.spawns).toEqual([{ command: "bun", args: [SOURCE_ENTRY], cwd: "/src/electron-app" }])
    expect(idle.launchctlCalls).toEqual([])

    const busy = new FakeMac({ running: true, present: [SOURCE_ENTRY] })
    expect(await ensureProjectdRunning(DEVELOPMENT, busy)).toBe("running")
    expect(busy.spawns).toEqual([])

    const noBun = new FakeMac({ present: [SOURCE_ENTRY] })
    noBun.spawnError = new Error("spawn bun ENOENT")
    expect(await ensureProjectdRunning(DEVELOPMENT, noBun)).toBe("failed")
    expect(noBun.logs.join("\n")).toContain("spawn bun ENOENT")
  })
})
