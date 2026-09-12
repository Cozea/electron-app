import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { planProjectdLaunch, type ProjectdLaunchContext } from "../../apps/desktop/electron/projectd/ProjectdLauncher"

/**
 * The packaged app must carry the macOS helper where the launcher looks for it.
 * When it is missing the daemon still starts, but it polls folders instead of
 * receiving FSEvents and cannot reach the Keychain identity, so nothing fails loudly.
 */

const repositoryRoot = path.resolve(__dirname, "../..")
const desktopRoot = path.join(repositoryRoot, "apps/desktop")
const requireFromHere = createRequire(import.meta.url)

interface ResourceEntry {
  from: string
  to: string
  filter?: string[]
}

const RESOURCES = "/Applications/Cozea.app/Contents/Resources"
const PACKAGED: ProjectdLaunchContext = {
  platform: "darwin",
  isPackaged: true,
  execPath: "/Applications/Cozea.app/Contents/MacOS/Cozea",
  resourcesPath: RESOURCES,
  repoRoot: "/src/electron-app",
  appVersion: "0.2.4",
  homeDir: "/Users/tester",
  tmpDir: "/tmp",
  uid: 501,
  socketPath: "/tmp/cozea-projectd-501.sock",
  env: {},
}

function helperPathHandedToDaemon(): string {
  const plan = planProjectdLaunch(PACKAGED, () => true)
  if (plan.kind !== "launch-agent") throw new Error(`expected a LaunchAgent plan, got ${plan.kind}`)
  const match = /<key>COZEA_MAC_HELPER_PATH<\/key>\s*<string>([^<]+)<\/string>/.exec(plan.plist)
  if (!match?.[1]) throw new Error("the LaunchAgent does not pass COZEA_MAC_HELPER_PATH")
  return match[1]
}

describe("projectd helper packaging", () => {
  it("ships the helper at the path the launcher gives the daemon", () => {
    const shipped = path.posix.relative(RESOURCES, helperPathHandedToDaemon())
    const config = requireFromHere(path.join(desktopRoot, "electron-builder.config.cjs")) as {
      extraResources: ResourceEntry[]
    }

    const entry = config.extraResources.find(
      (resource) =>
        resource.to === path.posix.dirname(shipped) &&
        (resource.filter ?? []).includes(path.posix.basename(shipped)),
    )

    expect(entry).toBeDefined()
    expect(path.resolve(desktopRoot, entry!.from)).toBe(path.join(repositoryRoot, "build/projectd-helper"))
  })

  it("stages the helper during predist", () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const prepareScript = fs.readFileSync(path.join(repositoryRoot, "scripts/prepare-projectd-helper.mjs"), "utf8")

    expect(scripts.predist).toContain("bun run prepare:projectd-helper")
    expect(scripts["prepare:projectd-helper"]).toBe("node scripts/prepare-projectd-helper.mjs")
    expect(prepareScript).toContain("path.join(repositoryRoot, 'build', 'projectd-helper')")
    expect(prepareScript).toContain("['arm64', 'x86_64']")
  })
})
