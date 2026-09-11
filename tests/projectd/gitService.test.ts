import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitLfs } from "../../apps/projectd/src/git/GitLfs"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdClient } from "@cozea/projectd-protocol"

describe("P05 GitService consolidation foundation", () => {
  const tmpDir = "/tmp"
  let testRepoDir: string
  let testSocketPath: string
  let gitService: GitService
  let server: ProjectdServer | null = null

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_git_repo_${id}`)
    testSocketPath = path.join(tmpDir, `test_git_socket_${id}.sock`)

    fs.mkdirSync(testRepoDir, { recursive: true })
    gitService = new GitService()
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    for (const p of [testRepoDir, testSocketPath]) {
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  })

  it("checks git health and qualifies Git + Git LFS", async () => {
    const health = await gitService.getHealth()
    expect(health.available).toBe(true)
    expect(health.gitVersion).toMatch(/^\d+\.\d+/)
    expect(health.supportsPorcelainV2).toBe(true)
    expect(health.supportsMergeTreeWriteTree).toBe(true)
  })

  it("handles unborn branch fixture accurately", async () => {
    await gitService.initRepo(testRepoDir, "unborn-branch")
    const status = await gitService.getStatus(testRepoDir)

    expect(status.isUnborn).toBe(true)
    expect(status.headOid).toBeNull()
    expect(status.clean).toBe(true)
    expect(status.files).toHaveLength(0)
  })

  it("handles custom default branch fixture", async () => {
    await gitService.initRepo(testRepoDir, "trunk")
    await gitService.createCommit(testRepoDir, "initial commit", {
      allowEmpty: true,
      author: { name: "Tester", email: "test@example.com" },
    })

    const branches = await gitService.getBranches(testRepoDir)
    expect(branches).toHaveLength(1)
    expect(branches[0].name).toBe("trunk")
    expect(branches[0].isCurrent).toBe(true)
  })

  it("handles detached HEAD fixture accurately", async () => {
    await gitService.initRepo(testRepoDir, "main")
    const commitOid = await gitService.createCommit(testRepoDir, "first commit", {
      allowEmpty: true,
      author: { name: "Tester", email: "test@example.com" },
    })

    // Checkout commit OID directly to detach HEAD
    await gitService.process.execute(["checkout", commitOid], { cwd: testRepoDir })

    const status = await gitService.getStatus(testRepoDir)
    expect(status.isDetached).toBe(true)
    expect(status.headRef).toBeNull()
    expect(status.headOid).toBe(commitOid)
  })

  it("handles Git attributes and custom filter fixture", async () => {
    await gitService.initRepo(testRepoDir, "main")

    // Write .gitattributes
    const gitattributes = `
*.txt text eol=lf
*.bin binary
*.png filter=lfs diff=lfs merge=lfs -text
*.special filter=custom-syntax
`
    fs.writeFileSync(path.join(testRepoDir, ".gitattributes"), gitattributes)

    const attrs = await gitService.checkAttributes(testRepoDir, [
      "document.txt",
      "data.bin",
      "image.png",
      "code.special",
      "ordinary.js",
    ])

    const txt = attrs.get("document.txt")
    expect(txt?.isBinary).toBe(false)
    expect(txt?.lineEnding).toBe("lf")

    const bin = attrs.get("data.bin")
    expect(bin?.isBinary).toBe(true)

    const png = attrs.get("image.png")
    expect(png?.isBinary).toBe(true)
    expect(png?.isLfs).toBe(true)

    const special = attrs.get("code.special")
    expect(special?.attributes["filter"]).toBe("custom-syntax")
  })

  it("validates Git LFS pointer parsing and creation", () => {
    const sha256 = "4c520ef69c687e35b7e8d35ebff1c77d40dd5bb13c9a2c3a5ef59163273e9e51"
    const size = 1048576

    const pointer = GitLfs.createPointer(sha256, size)
    expect(GitLfs.isLfsPointer(pointer)).toBe(true)

    const parsed = GitLfs.parsePointer(pointer)
    expect(parsed?.oid).toBe(`sha256:${sha256}`)
    expect(parsed?.size).toBe(size)

    expect(GitLfs.isLfsPointer("plain text content")).toBe(false)
    expect(GitLfs.parsePointer("plain text content")).toBeNull()
  })

  it("handles Git-aware ignore classification fixture", async () => {
    await gitService.initRepo(testRepoDir, "main")

    fs.writeFileSync(path.join(testRepoDir, ".gitignore"), "*.log\n.env*\nbuild/\n")

    const ignored = await gitService.checkIgnore(testRepoDir, [
      "app.log",
      "src/index.ts",
      ".env.local",
      "package.json",
      "build/bundle.js",
    ])

    expect(ignored.has("app.log")).toBe(true)
    expect(ignored.has(".env.local")).toBe(true)
    expect(ignored.has("build/bundle.js")).toBe(true)
    expect(ignored.has("src/index.ts")).toBe(false)
    expect(ignored.has("package.json")).toBe(false)
  })

  it("handles linked-worktree repository fixture", async () => {
    await gitService.initRepo(testRepoDir, "main")
    await gitService.createCommit(testRepoDir, "first commit", {
      allowEmpty: true,
      author: { name: "Tester", email: "test@example.com" },
    })

    const worktreeDir = path.join(tmpDir, `worktree_${Date.now()}`)

    try {
      // Create a linked worktree
      await gitService.process.execute(
        ["worktree", "add", worktreeDir, "-b", "worktree-branch"],
        { cwd: testRepoDir },
      )

      expect(fs.existsSync(worktreeDir)).toBe(true)

      // Status in linked worktree
      const status = await gitService.getStatus(worktreeDir)
      expect(status.headRef).toBe("worktree-branch")
      expect(status.clean).toBe(true)
    } finally {
      try {
        await gitService.process.execute(["worktree", "remove", "--force", worktreeDir], {
          cwd: testRepoDir,
          allowNonZeroExit: true,
        })
        if (fs.existsSync(worktreeDir)) {
          fs.rmSync(worktreeDir, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  })

  it("exposes GitService methods headlessly over projectd socket", async () => {
    await gitService.initRepo(testRepoDir, "main")
    await gitService.createCommit(testRepoDir, "root commit", {
      allowEmpty: true,
      author: { name: "Tester", email: "test@example.com" },
    })

    server = new ProjectdServer({ socketPath: testSocketPath })
    await server.start()

    const client = new ProjectdClient({ socketPath: testSocketPath })
    await client.connect()

    const health = await client.gitHealth()
    expect(health.available).toBe(true)

    const status = await client.gitStatus(testRepoDir)
    expect(status.headRef).toBe("main")
    expect(status.clean).toBe(true)

    const branches = await client.gitBranches(testRepoDir)
    expect(branches).toHaveLength(1)
    expect(branches[0].name).toBe("main")

    client.disconnect()
  })
})
