import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { GitService } from "../git/GitService"
import { fallbackIdentityEnv } from "../git/identity"
import { resolveWorkspaceFilePath } from "../filesystem/workspacePath"
import { RebaseJournal, type RebaseIndexVariant } from "./RebaseJournal"

export interface IsolatedRebaseReview {
  recoveryId: string
  fingerprint: string
  variants: RebaseIndexVariant[]
}

export type IsolatedRebaseChoice = { path: string } & (
  { kind: "variant"; stage: 1 | 2 | 3 } |
  { kind: "content"; content: Buffer; executable: boolean } |
  { kind: "delete" }
)

/** Operates exclusively in a retained detached worktree; never adopts or pushes. */
export class IsolatedRebaseResolution {
  readonly journal: RebaseJournal
  private readonly git: GitService

  constructor(journal: RebaseJournal, git: GitService) {
    this.journal = journal
    this.git = git
  }

  private async execute(args: string[], stdin?: Buffer) {
    const env = await fallbackIdentityEnv(this.git.process, this.journal.worktree, { name: "Cozea AutoGit", email: "autogit@cozea.local" })
    return this.git.process.execute(["-c", "commit.gpgsign=false", "-c", "core.editor=true", "-c",
      `core.hooksPath=${path.join(this.journal.directory, "no-hooks")}`, ...args],
    { cwd: this.journal.worktree, env, stdin, allowNonZeroExit: true, timeoutMs: 60_000 })
  }

  async preview(): Promise<import("@cozea/projectd-protocol").ProjectdRebaseReview> {
    if (["applied", "canceled"].includes(this.journal.record.state)) throw new Error("This rebase review is finished")
    if (["computed", "adopting", "adopted"].includes(this.journal.record.state) || this.journal.record.pendingResolution) {
      return { recoveryId: this.journal.record.id, state: this.journal.record.pendingResolution ? "resolving" : ["adopting", "adopted"].includes(this.journal.record.state) ? "adopting" : "computed", fingerprint: null, variants: [] }
    }
    const review = await this.review()
    let remaining = 1024 * 1024
    const variants = []
    for (const variant of review.variants) {
      let text: string | null = null
      const size = await this.execute(["cat-file", "-s", variant.oid])
      const bytes = Number(size.stdout.trim())
      if (size.success && bytes <= Math.min(64 * 1024, remaining) && variant.mode !== "160000") {
        const blob = await this.execute(["cat-file", "blob", variant.oid])
        if (blob.success && !blob.stdoutBuffer.includes(0) && Buffer.from(blob.stdout).equals(blob.stdoutBuffer)) {
          text = blob.stdout
          remaining -= blob.stdoutBuffer.length
        }
      }
      variants.push({ ...variant, text })
    }
    return { ...review, state: "conflicted", variants }
  }

  async review(): Promise<IsolatedRebaseReview> {
    if (this.journal.record.pendingResolution) throw new Error("Continue the retained resolution before reviewing another conflict")
    const head = await this.execute(["rev-parse", "--verify", "REBASE_HEAD"])
    const index = await this.execute(["ls-files", "--unmerged", "-z"])
    if (!head.success || !index.success || !index.stdout) throw new Error("This isolated rebase has no unresolved conflict step")
    await this.journal.captureConflicts(index.stdout)
    return { recoveryId: this.journal.record.id,
      fingerprint: createHash("sha256").update(this.journal.record.id).update(head.stdout).update(index.stdoutBuffer).digest("hex"),
      variants: this.journal.record.variants }
  }

  async resolve(fingerprint: string, choices: IsolatedRebaseChoice[]): Promise<
    { state: "computed"; commitOid: string } | { state: "conflicted"; review: IsolatedRebaseReview }
  > {
    const review = await this.review()
    if (review.fingerprint !== fingerprint) throw new Error("The isolated conflict changed. Review it again before resolving.")
    const paths = new Set(review.variants.map((variant) => variant.path))
    if (choices.length !== paths.size || new Set(choices.map((choice) => choice.path)).size !== paths.size || choices.some((choice) => !paths.has(choice.path))) {
      throw new Error("Resolve each reviewed conflict path exactly once")
    }
    // Validate every choice and parent before the first index/worktree mutation.
    const resolved: Array<{ path: string; absolute: string; oid: string | null; mode: string }> = []
    for (const choice of choices) {
      const absolute = await resolveWorkspaceFilePath(this.journal.worktree, choice.path)
      if (choice.kind === "delete") resolved.push({ path: choice.path, absolute, oid: null, mode: "0" })
      else if (choice.kind === "variant") {
        const variant = review.variants.find((entry) => entry.path === choice.path && entry.stage === choice.stage)
        if (!variant) throw new Error("The selected conflict variant is absent; choose deletion explicitly")
        resolved.push({ path: choice.path, absolute, oid: variant.oid, mode: variant.mode })
      } else {
        if (!Buffer.isBuffer(choice.content) || choice.content.length > 64 * 1024 * 1024) throw new Error("Resolution content exceeds the supported size")
        const object = await this.execute(["hash-object", "-w", "--stdin"], choice.content)
        if (!object.success) throw new Error("Could not retain the resolution content in Git")
        resolved.push({ path: choice.path, absolute, oid: object.stdout.trim(), mode: choice.executable ? "100755" : "100644" })
      }
    }
    const head = await this.execute(["rev-parse", "--verify", "REBASE_HEAD"])
    if (!head.success) throw new Error("The isolated rebase step disappeared")
    for (const [index, choice] of resolved.entries()) {
      if (!choice.oid) continue
      const pin = await this.execute(["update-ref", `refs/cozea/rebase-resolution/${this.journal.record.id}/${fingerprint}/${index}`, choice.oid])
      if (!pin.success) throw new Error("Could not retain the reviewed resolution object")
    }
    await this.journal.retainResolution({ rebaseHead: head.stdout.trim(), fingerprint,
      choices: resolved.map(({ path: filePath, oid, mode }) => ({ path: filePath, oid, mode })) })
    return this.continue()
  }

  private async applyRetainedResolution(): Promise<void> {
    const pending = this.journal.record.pendingResolution
    if (!pending) return
    const head = await this.execute(["rev-parse", "--verify", "REBASE_HEAD"])
    if (!head.success || head.stdout.trim() !== pending.rebaseHead) {
      // Git advanced to the next commit before its previous reply was received.
      await this.journal.finishResolutionStep()
      return
    }
    // Resolve the index directly, preserving binary bytes and Git modes without filters.
    for (const choice of pending.choices) {
      const absolute = await resolveWorkspaceFilePath(this.journal.worktree, choice.path)
      const result = choice.oid
        ? await this.execute(["update-index", "--add", "--cacheinfo", choice.mode, choice.oid, choice.path])
        : await this.execute(["update-index", "--force-remove", "--", choice.path])
      if (!result.success) throw new Error("Could not stage the isolated conflict resolution")
      if (!choice.oid) {
        const stat = await fs.lstat(absolute).catch(() => null)
        if (stat && !stat.isDirectory()) await fs.unlink(absolute)
      } else if (choice.mode !== "160000") {
        const checkout = await this.execute(["checkout-index", "--force", "--", choice.path])
        if (!checkout.success) throw new Error("Could not materialize the isolated conflict resolution")
      }
    }
  }

  /** Retry after staging or a lost successful continue response without staging again. */
  async continue(): Promise<{ state: "computed"; commitOid: string } | { state: "conflicted"; review: IsolatedRebaseReview }> {
    if (["adopting", "adopted"].includes(this.journal.record.state)) throw new Error("This rebase has begun adoption. Retry Apply to finish saving it.")
    if (this.journal.record.state === "computed" && this.journal.record.resultOid) {
      return { state: "computed", commitOid: this.journal.record.resultOid }
    }
    let activeSequencer = false
    for (const backend of ["rebase-merge", "rebase-apply"]) {
      const sequencer = await this.execute(["rev-parse", "--git-path", backend])
      if (!sequencer.success) throw new Error("Could not inspect the retained rebase sequencer")
      const sequencerPath = path.resolve(this.journal.worktree, sequencer.stdout.trim())
      if (await fs.stat(sequencerPath).then((stat) => stat.isDirectory(), () => false)) activeSequencer = true
    }
    if (activeSequencer) await this.applyRetainedResolution()
    const index = await this.execute(["ls-files", "--unmerged", "-z"])
    if (!index.success) throw new Error("Could not inspect the retained rebase index")
    if (index.stdout) return { state: "conflicted", review: await this.review() }
    if (activeSequencer) {
      const continued = await this.execute(["rebase", "--continue"])
      if (!continued.success) {
        const conflicts = await this.execute(["ls-files", "--unmerged", "-z"])
        if (conflicts.success && conflicts.stdout) {
          await this.journal.finishResolutionStep()
          return { state: "conflicted", review: await this.review() }
        }
        throw new Error("Git could not continue the isolated rebase. Its state has been retained.")
      }
    }
    // A lost successful continue reply has no sequencer left. Require the target
    // in HEAD ancestry so an aborted/reset worktree cannot be mistaken for a result.
    const ancestry = await this.execute(["merge-base", "--is-ancestor", this.journal.record.onto, "HEAD"])
    if (!ancestry.success) throw new Error("The retained worktree no longer contains the reviewed rebase target")
    const result = await this.execute(["rev-parse", "HEAD"])
    if (!result.success) throw new Error("Could not resolve the isolated rebased commit")
    const commitOid = result.stdout.trim()
    const pin = await this.execute(["update-ref", `refs/cozea/rebase-results/${this.journal.record.id}`, commitOid])
    if (!pin.success) throw new Error("Could not retain the rebased result")
    await this.journal.computed(commitOid)
    return { state: "computed", commitOid }
  }
}
