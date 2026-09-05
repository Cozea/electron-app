import { app } from "electron"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

export type GitRuntimeSource = "system" | "missing"

export interface GitRuntimeHealth {
  available: boolean
  executablePath?: string
  source: GitRuntimeSource
  gitVersion?: string
  supportsMergeFile: boolean
  supportsZdiff3: boolean
  supportsMergeTree: boolean
  supportsMergeTreeWriteTree: boolean
  preflightCheckedAt: number
  preflightOk: boolean
  error?: string
}

export interface GitCommandResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stdoutBytes?: Uint8Array
  stderr: string
  executablePath: string
  source: GitRuntimeSource
  error?: string
}

export interface MergePreviewInput {
  baseContent: string
  localContent: string
  cloudContent: string
  strategy?: "zdiff3" | "diff3"
  labels?: {
    local?: string
    base?: string
    cloud?: string
  }
}

export interface MergePreviewOutput {
  success: boolean
  mergedContent: string
  hasConflicts: boolean
  conflictCount: number
  strategyUsed: "zdiff3" | "diff3"
  gitVersion: string
  error?: string
}

export interface MergeTreeFileInput {
  path: string
  content: string
}

export interface MergeTreePreviewInput {
  baseFiles: MergeTreeFileInput[]
  localFiles: MergeTreeFileInput[]
  cloudFiles: MergeTreeFileInput[]
  maxPreviewFiles?: number
  maxPreviewBytes?: number
}

export interface MergeTreeConflict {
  path: string
  message?: string
}

export interface MergeTreePreviewOutput {
  success: boolean
  clean: boolean
  treeOid?: string
  conflicts: MergeTreeConflict[]
  mergedFiles: MergeTreeFileInput[]
  gitVersion: string
  rawOutput?: string
  error?: string
}

let cachedHealth: GitRuntimeHealth | null = null
let healthCacheAt = 0
const HEALTH_CACHE_TTL_MS = 30_000
const EXPLICIT_GIT_EXECUTABLE_ENV = "COZEA_GIT_EXECUTABLE"

let dirsEnsured = false

function ensureGitRuntimeConfigDirs(): string {
  const baseDir = path.join(app.getPath("userData"), "git-runtime")
  if (!dirsEnsured) {
    const configDir = path.join(baseDir, "config")
    const cacheDir = path.join(baseDir, "cache")
    const homeDir = path.join(baseDir, "home")
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.mkdirSync(homeDir, { recursive: true })
    dirsEnsured = true
  }
  return baseDir
}

export function resolveGitExecutablePath(): { path: string | null; source: GitRuntimeSource } {
  const explicitExecutable = process.env[EXPLICIT_GIT_EXECUTABLE_ENV]?.trim()
  if (explicitExecutable) {
    const absolutePath = path.resolve(explicitExecutable)
    if (fs.existsSync(absolutePath)) {
      return { path: absolutePath, source: "system" }
    }
    return { path: null, source: "missing" }
  }

  return { path: "git", source: "system" }
}

function createGitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const runtimeBase = ensureGitRuntimeConfigDirs()
  const homeDir = path.join(runtimeBase, "home")
  const configDir = path.join(runtimeBase, "config")
  const cacheDir = path.join(runtimeBase, "cache")

  return {
    ...process.env,
    ...extra,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
  }
}

export async function runGitCommand(
  args: string[],
  options?: {
    cwd?: string
    env?: Record<string, string>
    stdin?: string
    timeoutMs?: number
    captureStdoutBytes?: boolean
    maxOutputBytes?: number
    signal?: AbortSignal
  }
): Promise<GitCommandResult> {
  const resolved = resolveGitExecutablePath()
  if (!resolved.path) {
    return {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      executablePath: "",
      source: resolved.source,
      error: "Git executable not found",
    }
  }

  return new Promise((resolve) => {
    const child = spawn(resolved.path!, args, {
      cwd: options?.cwd,
      env: createGitEnv(options?.env),
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    const stdoutChunks: Buffer[] = []
    let outputBytes = 0
    let outputExceeded = false
    let stderr = ""
    let timedOut = false
    let timeout: NodeJS.Timeout | null = null
    const abort = () => { child.kill("SIGKILL") }
    options?.signal?.addEventListener("abort", abort, { once: true })
    if (options?.signal?.aborted) abort()

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true
        try {
          child.kill("SIGKILL")
        } catch {
          // ignore kill failures
        }
      }, options.timeoutMs)
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (options?.maxOutputBytes && outputBytes > options.maxOutputBytes) { outputExceeded = true; child.kill("SIGKILL"); return }
      if (options?.captureStdoutBytes) stdoutChunks.push(Buffer.from(chunk))
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (options?.maxOutputBytes && outputBytes > options.maxOutputBytes) { outputExceeded = true; child.kill("SIGKILL"); return }
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      options?.signal?.removeEventListener("abort", abort)
      if (timeout) clearTimeout(timeout)
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        executablePath: resolved.path!,
        source: resolved.source,
        error: error.message || "Failed to execute git command",
      })
    })

    child.on("close", (code) => {
      options?.signal?.removeEventListener("abort", abort)
      if (timeout) clearTimeout(timeout)
      resolve({
        success: !options?.signal?.aborted && !timedOut && !outputExceeded && code === 0,
        exitCode: code,
        stdout,
        ...(options?.captureStdoutBytes ? { stdoutBytes: Buffer.concat(stdoutChunks) } : {}),
        stderr,
        executablePath: resolved.path!,
        source: resolved.source,
        error: outputExceeded ? "Git output exceeds the requested limit" : timedOut ? "Git command timed out" : undefined,
      })
    })

    if (options?.stdin !== undefined) {
      child.stdin.write(options.stdin)
    }
    child.stdin.end()
  })
}

function parseGitVersion(raw: string): string | undefined {
  const match = raw.match(/git version\s+([^\s]+)/i)
  return match?.[1]
}

function hasGitOption(helpText: string, optionName: string): boolean {
  const escapedOption = optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const directPattern = new RegExp(`--${escapedOption}\\b`)
  const toggledPattern = new RegExp(`--\\[no-\\]${escapedOption}\\b`)
  return directPattern.test(helpText) || toggledPattern.test(helpText)
}

function normalizeRepoRelativePath(input: string): string | null {
  const normalized = input
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
  if (!normalized) return null
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((part) => part === "." || part === "..")) return null
  return parts.join("/")
}

async function resetRepoWorktree(repoDir: string): Promise<void> {
  const rmResult = await runGitCommand(["rm", "-r", "--ignore-unmatch", "."], {
    cwd: repoDir,
    timeoutMs: 10_000,
  })
  if (rmResult.exitCode === null) {
    throw new Error(rmResult.error ?? "Failed to reset git index")
  }

  const cleanResult = await runGitCommand(["clean", "-fdx"], {
    cwd: repoDir,
    timeoutMs: 10_000,
  })
  if (!cleanResult.success) {
    throw new Error(cleanResult.error ?? (cleanResult.stderr.trim() || "Failed to clean git worktree"))
  }
}

function writeSnapshotFiles(repoDir: string, files: MergeTreeFileInput[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    const normalizedPath = normalizeRepoRelativePath(file.path)
    if (!normalizedPath) continue
    if (seen.has(normalizedPath)) continue
    seen.add(normalizedPath)

    const fullPath = path.join(repoDir, normalizedPath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, file.content, "utf-8")
  }
}

async function createSnapshotCommit(
  repoDir: string,
  branchName: string,
  files: MergeTreeFileInput[],
  baseCommit?: string
): Promise<string> {
  const checkoutArgs = baseCommit
    ? ["checkout", "-B", branchName, baseCommit]
    : ["checkout", "--orphan", branchName]
  const checkoutResult = await runGitCommand(checkoutArgs, {
    cwd: repoDir,
    timeoutMs: 10_000,
  })
  if (!checkoutResult.success) {
    throw new Error(
      checkoutResult.error ?? (checkoutResult.stderr.trim() || "Failed to checkout snapshot branch")
    )
  }

  await resetRepoWorktree(repoDir)
  writeSnapshotFiles(repoDir, files)

  const addResult = await runGitCommand(["add", "-A"], { cwd: repoDir, timeoutMs: 10_000 })
  if (!addResult.success) {
    throw new Error(addResult.error ?? (addResult.stderr.trim() || "Failed to stage snapshot files"))
  }

  const commitResult = await runGitCommand(
    ["commit", "--allow-empty", "-m", `snapshot:${branchName}`],
    { cwd: repoDir, timeoutMs: 10_000 }
  )
  if (!commitResult.success) {
    throw new Error(
      commitResult.error ?? (commitResult.stderr.trim() || "Failed to create snapshot commit")
    )
  }

  const revParse = await runGitCommand(["rev-parse", "HEAD"], { cwd: repoDir, timeoutMs: 10_000 })
  if (!revParse.success || !revParse.stdout.trim()) {
    throw new Error(revParse.error ?? (revParse.stderr.trim() || "Failed to resolve snapshot commit"))
  }

  return revParse.stdout.trim()
}

function parseMergeTreeConflicts(output: string): MergeTreeConflict[] {
  const conflictByPath = new Map<string, MergeTreeConflict>()
  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    const stageMatch = line.match(/^\d{6}\s+[0-9a-f]{40}\s+[123]\t(.+)$/)
    if (stageMatch) {
      const pathValue = normalizeRepoRelativePath(stageMatch[1])
      if (!pathValue) continue
      if (!conflictByPath.has(pathValue)) {
        conflictByPath.set(pathValue, { path: pathValue, message: "Tree conflict" })
      }
      continue
    }

    const autoMergeMatch = line.match(/^Auto-merging (.+)$/)
    if (autoMergeMatch) {
      const pathValue = normalizeRepoRelativePath(autoMergeMatch[1])
      if (!pathValue) continue
      if (!conflictByPath.has(pathValue)) {
        conflictByPath.set(pathValue, { path: pathValue })
      }
      continue
    }

    const conflictMsgMatch = line.match(/^CONFLICT \([^)]+\): (.+)$/)
    if (conflictMsgMatch) {
      const message = conflictMsgMatch[1]
      const inPathMatch = message.match(/ in (.+)$/)
      const candidatePath = inPathMatch ? inPathMatch[1] : ""
      const pathValue = normalizeRepoRelativePath(candidatePath)
      if (pathValue) {
        conflictByPath.set(pathValue, {
          path: pathValue,
          message,
        })
      }
    }
  }

  return Array.from(conflictByPath.values())
}

async function readMergedTreeFiles(
  repoDir: string,
  treeOid: string,
  maxPreviewFiles: number,
  maxPreviewBytes: number
): Promise<MergeTreeFileInput[]> {
  const listResult = await runGitCommand(["ls-tree", "-r", "--name-only", treeOid], {
    cwd: repoDir,
    timeoutMs: 10_000,
  })
  if (!listResult.success) {
    return []
  }

  const filePaths = listResult.stdout
    .split(/\r?\n/)
    .map((line) => normalizeRepoRelativePath(line))
    .filter((line): line is string => Boolean(line))

  const mergedFiles: MergeTreeFileInput[] = []
  let byteBudget = 0
  for (const filePath of filePaths) {
    if (mergedFiles.length >= maxPreviewFiles) break

    const showResult = await runGitCommand(["show", `${treeOid}:${filePath}`], {
      cwd: repoDir,
      timeoutMs: 10_000,
    })
    if (!showResult.success) continue

    const content = showResult.stdout
    if (content.includes("\u0000")) continue

    const bytes = Buffer.byteLength(content, "utf-8")
    if (byteBudget + bytes > maxPreviewBytes) break
    byteBudget += bytes

    mergedFiles.push({ path: filePath, content })
  }

  return mergedFiles
}

async function runMergeSmokeTest(): Promise<{ ok: boolean; error?: string }> {
  const tempDir = path.join(os.tmpdir(), `cozea-git-smoke-${randomUUID()}`)
  fs.mkdirSync(tempDir, { recursive: true })
  const basePath = path.join(tempDir, "base.txt")
  const localPath = path.join(tempDir, "local.txt")
  const cloudPath = path.join(tempDir, "cloud.txt")

  try {
    fs.writeFileSync(basePath, "hello\nworld\n", "utf-8")
    fs.writeFileSync(localPath, "hello\nworld local\n", "utf-8")
    fs.writeFileSync(cloudPath, "hello\nworld cloud\n", "utf-8")

    const result = await runGitCommand(
      [
        "merge-file",
        "--stdout",
        "--zdiff3",
        "-L",
        "LOCAL",
        "-L",
        "BASE",
        "-L",
        "CLOUD",
        localPath,
        basePath,
        cloudPath,
      ],
      { cwd: tempDir, timeoutMs: 10_000 }
    )

    if (result.exitCode === null) {
      return { ok: false, error: result.error ?? "Git merge smoke test failed" }
    }

    if (result.exitCode > 1) {
      return {
        ok: false,
        error: result.stderr.trim() || `merge-file exited with code ${result.exitCode}`,
      }
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown smoke test error",
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore temp cleanup errors
    }
  }
}

export async function getGitRuntimeHealth(force = false): Promise<GitRuntimeHealth> {
  if (!force && cachedHealth && Date.now() - healthCacheAt < HEALTH_CACHE_TTL_MS) {
    return cachedHealth
  }

  const startedAt = Date.now()
  const resolved = resolveGitExecutablePath()
  if (!resolved.path) {
    const health: GitRuntimeHealth = {
      available: false,
      source: resolved.source,
      supportsMergeFile: false,
      supportsZdiff3: false,
      supportsMergeTree: false,
      supportsMergeTreeWriteTree: false,
      preflightCheckedAt: startedAt,
      preflightOk: false,
      error: "Git executable not found",
    }
    cachedHealth = health
    healthCacheAt = Date.now()
    return health
  }

  const versionResult = await runGitCommand(["--version"], { timeoutMs: 10_000 })
  if (!versionResult.success || !versionResult.stdout.trim()) {
    const health: GitRuntimeHealth = {
      available: false,
      executablePath: resolved.path,
      source: resolved.source,
      supportsMergeFile: false,
      supportsZdiff3: false,
      supportsMergeTree: false,
      supportsMergeTreeWriteTree: false,
      preflightCheckedAt: startedAt,
      preflightOk: false,
      error:
        versionResult.error ??
        versionResult.stderr.trim() ??
        "Unable to query git version",
    }
    cachedHealth = health
    healthCacheAt = Date.now()
    return health
  }

  const mergeFileHelp = await runGitCommand(["merge-file", "-h"], { timeoutMs: 10_000 })
  const mergeTreeHelp = await runGitCommand(["merge-tree", "-h"], { timeoutMs: 10_000 })

  const mergeFileText = `${mergeFileHelp.stdout}\n${mergeFileHelp.stderr}`
  const mergeTreeText = `${mergeTreeHelp.stdout}\n${mergeTreeHelp.stderr}`

  const supportsMergeFile = mergeFileText.includes("merge-file")
  const supportsZdiff3 = hasGitOption(mergeFileText, "zdiff3")
  const supportsMergeTree = mergeTreeText.includes("merge-tree")
  const supportsMergeTreeWriteTree = hasGitOption(mergeTreeText, "write-tree")

  const smoke = await runMergeSmokeTest()

  const health: GitRuntimeHealth = {
    available:
      versionResult.success &&
      supportsMergeFile &&
      supportsMergeTree &&
      smoke.ok,
    executablePath: resolved.path,
    source: resolved.source,
    gitVersion: parseGitVersion(versionResult.stdout) ?? versionResult.stdout.trim(),
    supportsMergeFile,
    supportsZdiff3,
    supportsMergeTree,
    supportsMergeTreeWriteTree,
    preflightCheckedAt: Date.now(),
    preflightOk:
      versionResult.success &&
      supportsMergeFile &&
      supportsZdiff3 &&
      supportsMergeTree &&
      supportsMergeTreeWriteTree &&
      smoke.ok,
    error: smoke.ok ? undefined : smoke.error,
  }

  cachedHealth = health
  healthCacheAt = Date.now()
  return health
}

export async function mergeTextWithGit(input: MergePreviewInput): Promise<MergePreviewOutput> {
  const health = await getGitRuntimeHealth()
  if (!health.available) {
    return {
      success: false,
      mergedContent: "",
      hasConflicts: false,
      conflictCount: 0,
      strategyUsed: "diff3",
      gitVersion: health.gitVersion ?? "unknown",
      error: health.error ?? "Git runtime unavailable",
    }
  }

  const strategy: "zdiff3" | "diff3" =
    input.strategy === "diff3"
      ? "diff3"
      : health.supportsZdiff3
        ? "zdiff3"
        : "diff3"

  const tempDir = path.join(os.tmpdir(), `cozea-git-merge-${randomUUID()}`)
  fs.mkdirSync(tempDir, { recursive: true })

  const basePath = path.join(tempDir, "base.tmp")
  const localPath = path.join(tempDir, "local.tmp")
  const cloudPath = path.join(tempDir, "cloud.tmp")

  try {
    fs.writeFileSync(basePath, input.baseContent, "utf-8")
    fs.writeFileSync(localPath, input.localContent, "utf-8")
    fs.writeFileSync(cloudPath, input.cloudContent, "utf-8")

    const args = [
      "merge-file",
      "--stdout",
      strategy === "zdiff3" ? "--zdiff3" : "--diff3",
      "-L",
      input.labels?.local ?? "LOCAL",
      "-L",
      input.labels?.base ?? "BASE",
      "-L",
      input.labels?.cloud ?? "CLOUD",
      localPath,
      basePath,
      cloudPath,
    ]

    const merged = await runGitCommand(args, { cwd: tempDir, timeoutMs: 15_000 })
    if (merged.exitCode === null) {
      return {
        success: false,
        mergedContent: "",
        hasConflicts: false,
        conflictCount: 0,
        strategyUsed: strategy,
        gitVersion: health.gitVersion ?? "unknown",
        error: merged.error ?? "Git merge command failed",
      }
    }

    if (merged.exitCode > 1) {
      return {
        success: false,
        mergedContent: "",
        hasConflicts: false,
        conflictCount: 0,
        strategyUsed: strategy,
        gitVersion: health.gitVersion ?? "unknown",
        error: merged.stderr.trim() || `git merge-file failed (${merged.exitCode})`,
      }
    }

    const conflictCount = (merged.stdout.match(/^<{7}\s/mg) ?? []).length

    return {
      success: true,
      mergedContent: merged.stdout,
      hasConflicts: merged.exitCode === 1 || conflictCount > 0,
      conflictCount,
      strategyUsed: strategy,
      gitVersion: health.gitVersion ?? "unknown",
    }
  } catch (error) {
    return {
      success: false,
      mergedContent: "",
      hasConflicts: false,
      conflictCount: 0,
      strategyUsed: strategy,
      gitVersion: health.gitVersion ?? "unknown",
      error: error instanceof Error ? error.message : "Git merge failed",
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

export async function mergeTreeWithGit(
  input: MergeTreePreviewInput
): Promise<MergeTreePreviewOutput> {
  const health = await getGitRuntimeHealth()
  if (!health.available || !health.supportsMergeTree || !health.supportsMergeTreeWriteTree) {
    return {
      success: false,
      clean: false,
      conflicts: [],
      mergedFiles: [],
      gitVersion: health.gitVersion ?? "unknown",
      error: health.error ?? "Git merge-tree is unavailable",
    }
  }

  const maxPreviewFiles = Math.max(1, Math.min(1_000, input.maxPreviewFiles ?? 256))
  const maxPreviewBytes = Math.max(1_024, Math.min(20 * 1024 * 1024, input.maxPreviewBytes ?? 2 * 1024 * 1024))

  const tempDir = path.join(os.tmpdir(), `cozea-git-merge-tree-${randomUUID()}`)
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    const init = await runGitCommand(["init"], { cwd: tempDir, timeoutMs: 10_000 })
    if (!init.success) {
      return {
        success: false,
        clean: false,
        conflicts: [],
        mergedFiles: [],
        gitVersion: health.gitVersion ?? "unknown",
        error: init.error ?? (init.stderr.trim() || "Failed to initialize merge-tree repository"),
      }
    }

    const configEmail = await runGitCommand(["config", "user.email", "sync@cozea.local"], {
      cwd: tempDir,
      timeoutMs: 10_000,
    })
    const configName = await runGitCommand(["config", "user.name", "Cozea Sync"], {
      cwd: tempDir,
      timeoutMs: 10_000,
    })
    if (!configEmail.success || !configName.success) {
      return {
        success: false,
        clean: false,
        conflicts: [],
        mergedFiles: [],
        gitVersion: health.gitVersion ?? "unknown",
        error: "Failed to configure temporary merge-tree repository",
      }
    }

    const baseBranch = `base-${randomUUID()}`
    const localBranch = `ours-${randomUUID()}`
    const cloudBranch = `theirs-${randomUUID()}`

    const baseCommit = await createSnapshotCommit(tempDir, baseBranch, input.baseFiles)
    const localCommit = await createSnapshotCommit(tempDir, localBranch, input.localFiles, baseCommit)
    const cloudCommit = await createSnapshotCommit(tempDir, cloudBranch, input.cloudFiles, baseCommit)

    const merged = await runGitCommand(
      [
        "merge-tree",
        "--write-tree",
        "--messages",
        "--merge-base",
        baseCommit,
        localCommit,
        cloudCommit,
      ],
      { cwd: tempDir, timeoutMs: 20_000 }
    )

    const rawOutput = [merged.stdout, merged.stderr].filter(Boolean).join("\n").trim()
    const firstLine = merged.stdout.split(/\r?\n/)[0]?.trim()
    const treeOid = /^[0-9a-f]{40}$/i.test(firstLine) ? firstLine : undefined
    const conflicts = parseMergeTreeConflicts(rawOutput)

    if (merged.exitCode === null || !treeOid) {
      return {
        success: false,
        clean: false,
        conflicts,
        mergedFiles: [],
        gitVersion: health.gitVersion ?? "unknown",
        rawOutput,
        error: merged.error ?? (merged.stderr.trim() || "git merge-tree failed"),
      }
    }

    const mergedFiles = await readMergedTreeFiles(tempDir, treeOid, maxPreviewFiles, maxPreviewBytes)
    const clean = merged.exitCode === 0 && conflicts.length === 0

    return {
      success: true,
      clean,
      treeOid,
      conflicts,
      mergedFiles,
      gitVersion: health.gitVersion ?? "unknown",
      rawOutput,
    }
  } catch (error) {
    return {
      success: false,
      clean: false,
      conflicts: [],
      mergedFiles: [],
      gitVersion: health.gitVersion ?? "unknown",
      error: error instanceof Error ? error.message : "Git merge-tree failed",
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore temp cleanup errors
    }
  }
}
