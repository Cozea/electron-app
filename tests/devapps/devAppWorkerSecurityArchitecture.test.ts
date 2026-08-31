import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8")

describe("DevApp worker security architecture", () => {
  it("keeps published worker execution disconnected until the container runtime exists", () => {
    const artifactService = read("apps/desktop/electron/services/OrgDevAppArtifactService.ts")
    const main = read("apps/desktop/electron/main.ts")
    expect(artifactService).not.toContain("DevAppWorkerHost")
    expect(artifactService).not.toContain("devAppWorkerHost")
    expect(main.match(/worker: devAppWorkerHost/g)).toHaveLength(1)
  })

  it("does not inherit the parent environment into a development worker", () => {
    const adapter = read("apps/desktop/electron/services/devAppUtilityProcess.ts")
    expect(adapter).toContain('"--permission"')
    expect(adapter).toContain("--allow-fs-read=")
    expect(adapter).toContain("--allow-fs-write=")
    expect(adapter).not.toContain("...process.env")
    expect(adapter).not.toMatch(/\bHOME\s*:/)
    expect(adapter).not.toMatch(/\bPATH\s*:/)
  })

  it("requires explicit approval for every development worker", () => {
    const session = read("apps/desktop/electron/services/DevAppPreviewSession.ts")
    expect(session).toContain("requireExplicitApproval: workerExecution")
    expect(session).toContain("workerExecution ? trust.expiresAt : null")
  })
})
