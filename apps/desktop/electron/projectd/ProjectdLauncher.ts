/**
 * Starts cozea-projectd when nothing answers on its socket.
 *
 * Master Specification: Section 8.1, P03
 *
 * The packaged app registers the daemon as a per-user LaunchAgent, so launchd owns
 * its lifetime: the daemon starts at login, restarts after a crash, and keeps
 * running after the app quits. The agent runs the bundled projectd.mjs on the app's
 * own Electron binary in Node mode. A development build starts the daemon from
 * source instead, detached so it outlives the app. Electron never stops the daemon.
 */

import path from "node:path"

export const PROJECTD_LAUNCH_AGENT_LABEL = "app.cozea.projectd"

const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 250
const BOOTSTRAP_ATTEMPTS = 3
const BOOTSTRAP_RETRY_MS = 500

export interface ProjectdLaunchContext {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** The app's Electron binary, which runs projectd.mjs in Node mode. */
  execPath: string
  resourcesPath: string
  /** Repository root of a development checkout. */
  repoRoot: string
  appVersion: string
  homeDir: string
  tmpDir: string
  uid: number
  socketPath: string
  env: Readonly<Record<string, string | undefined>>
}

export type ProjectdLaunchPlan =
  | { kind: "skip"; reason: string }
  | { kind: "spawn"; command: string; args: string[]; cwd: string; logPath: string }
  | { kind: "launch-agent"; label: string; plistPath: string; plist: string; logDir: string }

export interface ProjectdLauncherEffects {
  /** True when a daemon answers a health check on the socket. */
  probe(): Promise<boolean>
  exists(filePath: string): boolean
  readFile(filePath: string): string | null
  /** Writes the file, creating its folder. */
  writeFile(filePath: string, content: string): void
  mkdir(dirPath: string): void
  launchctl(args: string[]): Promise<{ ok: boolean; output: string }>
  /** Resolves once the process runs; rejects when it cannot start. */
  spawnDetached(command: string, args: string[], options: { cwd: string; logPath: string }): Promise<void>
  sleep(ms: number): Promise<void>
  log(message: string): void
}

export type ProjectdLaunchOutcome = "running" | "started" | "restarted" | "skipped" | "failed"

export function planProjectdLaunch(
  context: ProjectdLaunchContext,
  exists: (filePath: string) => boolean,
): ProjectdLaunchPlan {
  if (context.env.COZEA_PROJECTD_AUTOSTART === "0") {
    return { kind: "skip", reason: "COZEA_PROJECTD_AUTOSTART is 0" }
  }
  if (context.platform !== "darwin") {
    return { kind: "skip", reason: "cozea-projectd runs on macOS only" }
  }

  if (!context.isPackaged) {
    const entry = path.join(context.repoRoot, "apps", "projectd", "src", "main.ts")
    if (!exists(entry)) return { kind: "skip", reason: `no projectd source at ${entry}` }
    return {
      kind: "spawn",
      command: "bun",
      args: [entry],
      cwd: context.repoRoot,
      logPath: path.join(context.tmpDir, "cozea-projectd-dev.log"),
    }
  }

  const bundle = path.join(context.resourcesPath, "projectd", "projectd.mjs")
  if (!exists(bundle)) return { kind: "skip", reason: `no projectd bundle at ${bundle}` }

  const logDir = path.join(context.homeDir, "Library", "Logs", "Cozea")
  const environment: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    COZEA_PROJECTD_SOCKET: context.socketPath,
    // A new app version changes the agent, and reloading it restarts the daemon on the new bundle.
    COZEA_PROJECTD_APP_VERSION: context.appVersion,
  }
  const helper = path.join(context.resourcesPath, "projectd", "cozea-projectd-mac-helper")
  if (exists(helper)) environment.COZEA_MAC_HELPER_PATH = helper

  return {
    kind: "launch-agent",
    label: PROJECTD_LAUNCH_AGENT_LABEL,
    plistPath: path.join(context.homeDir, "Library", "LaunchAgents", `${PROJECTD_LAUNCH_AGENT_LABEL}.plist`),
    logDir,
    plist: buildLaunchAgentPlist({
      label: PROJECTD_LAUNCH_AGENT_LABEL,
      programArguments: [context.execPath, bundle],
      environment,
      logPath: path.join(logDir, "projectd.log"),
    }),
  }
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function buildLaunchAgentPlist(input: {
  label: string
  programArguments: readonly string[]
  environment: Readonly<Record<string, string>>
  logPath: string
}): string {
  const key = (name: string, indent = "  ") => `${indent}<key>${xmlText(name)}</key>`
  const string = (value: string, indent = "  ") => `${indent}<string>${xmlText(value)}</string>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    key("Label"),
    string(input.label),
    key("ProgramArguments"),
    "  <array>",
    ...input.programArguments.map((argument) => string(argument, "    ")),
    "  </array>",
    key("EnvironmentVariables"),
    "  <dict>",
    ...Object.keys(input.environment)
      .sort()
      .flatMap((name) => [key(name, "    "), string(input.environment[name] ?? "", "    ")]),
    "  </dict>",
    key("RunAtLoad"),
    "  <true/>",
    key("KeepAlive"),
    "  <true/>",
    key("ProcessType"),
    string("Interactive"),
    key("StandardOutPath"),
    string(input.logPath),
    key("StandardErrorPath"),
    string(input.logPath),
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

async function waitUntilReachable(effects: ProjectdLauncherEffects, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += READY_POLL_MS) {
    if (await effects.probe()) return true
    await effects.sleep(READY_POLL_MS)
  }
  return effects.probe()
}

async function bootstrapAgent(effects: ProjectdLauncherEffects, domain: string, plistPath: string): Promise<boolean> {
  let output = ""
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    const result = await effects.launchctl(["bootstrap", domain, plistPath])
    if (result.ok) return true
    output = result.output
    // Right after a bootout, launchd can still be unloading the previous copy.
    if (attempt < BOOTSTRAP_ATTEMPTS) await effects.sleep(BOOTSTRAP_RETRY_MS)
  }
  effects.log(`launchctl could not load ${plistPath}: ${output || "no output"}`)
  return false
}

export async function ensureProjectdRunning(
  context: ProjectdLaunchContext,
  effects: ProjectdLauncherEffects,
  readyTimeoutMs = READY_TIMEOUT_MS,
): Promise<ProjectdLaunchOutcome> {
  const plan = planProjectdLaunch(context, (filePath) => effects.exists(filePath))
  const reachable = await effects.probe()

  if (plan.kind === "skip") {
    if (!reachable) effects.log(`Not starting cozea-projectd: ${plan.reason}`)
    return reachable ? "running" : "skipped"
  }

  if (plan.kind === "spawn") {
    if (reachable) return "running"
    try {
      await effects.spawnDetached(plan.command, plan.args, { cwd: plan.cwd, logPath: plan.logPath })
    } catch (error) {
      effects.log(`Could not start cozea-projectd with ${plan.command}: ${errorMessage(error)}`)
      return "failed"
    }
    effects.log(`Started cozea-projectd from source; it logs to ${plan.logPath}`)
    return (await waitUntilReachable(effects, readyTimeoutMs)) ? "started" : "failed"
  }

  const domain = `gui/${context.uid}`
  const service = `${domain}/${plan.label}`
  const installed = effects.readFile(plan.plistPath)
  if (installed === plan.plist && reachable) return "running"

  if (installed !== plan.plist) {
    effects.mkdir(plan.logDir)
    effects.writeFile(plan.plistPath, plan.plist)
    // Reloading a changed agent (first install, or an app update) restarts the daemon on the current bundle.
    await effects.launchctl(["bootout", service])
    if (!(await bootstrapAgent(effects, domain, plan.plistPath))) return "failed"
  } else {
    // The agent is current but nothing answers: restart it, or load it if launchd lost it.
    const kicked = await effects.launchctl(["kickstart", "-k", service])
    if (!kicked.ok && !(await bootstrapAgent(effects, domain, plan.plistPath))) return "failed"
  }

  if (!(await waitUntilReachable(effects, readyTimeoutMs))) {
    effects.log(`cozea-projectd did not answer after launchd loaded ${plan.plistPath}`)
    return "failed"
  }
  return installed !== plan.plist && reachable ? "restarted" : "started"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
