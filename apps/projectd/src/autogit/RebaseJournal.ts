import { randomUUID, createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { RoomCheckpointInput } from "../collaboration/SessionRoomClient"

export interface RebaseIndexVariant {
  path: string
  stage: 1 | 2 | 3
  mode: string
  oid: string
}

export interface RebaseJournalRecord {
  version: 1
  id: string
  sessionId: string
  from: string
  onto: string
  basisSequence: number
  state: "prepared" | "conflicted" | "computed" | "adopting" | "adopted" | "applied" | "canceled"
  createdAt: number
  variants: RebaseIndexVariant[]
  resultOid?: string
  pendingCheckpoint?: RoomCheckpointInput
  pendingResolution?: {
    rebaseHead: string
    fingerprint: string
    choices: Array<{ path: string; oid: string | null; mode: string }>
  }
}

/** Metadata stays alongside Git's private objects; conflicted worktrees retain exact index stages. */
export class RebaseJournal {
  readonly directory: string
  readonly record: RebaseJournalRecord

  private constructor(directory: string, record: RebaseJournalRecord) {
    this.directory = directory
    this.record = record
  }

  get worktree(): string { return path.join(this.directory, "worktree") }

  static async open(commonGitDirectory: string, sessionId: string, id: string): Promise<RebaseJournal> {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new Error("Invalid rebase recovery ID")
    const directory = path.join(commonGitDirectory, "cozea", "rebases", createHash("sha256").update(sessionId).digest("hex"), id)
    const record = JSON.parse(await fs.readFile(path.join(directory, "record.json"), "utf8")) as RebaseJournalRecord
    if (record.version !== 1 || record.id !== id || record.sessionId !== sessionId ||
      ![record.from, record.onto].every((oid) => typeof oid === "string" && /^[a-f0-9]{40,64}$/.test(oid)) ||
      !Number.isSafeInteger(record.basisSequence) || record.basisSequence < 0 ||
      !["prepared", "conflicted", "computed", "adopting", "adopted", "applied", "canceled"].includes(record.state) || !Array.isArray(record.variants) ||
      record.variants.some((variant) => !variant || typeof variant.path !== "string" ||
        ![1, 2, 3].includes(variant.stage) || !/^\d{6}$/.test(variant.mode) || !/^[a-f0-9]{40,64}$/.test(variant.oid)) ||
      (["computed", "adopting", "adopted"].includes(record.state) && (typeof record.resultOid !== "string" || !/^[a-f0-9]{40,64}$/.test(record.resultOid)))) {
      throw new Error("Invalid retained rebase record")
    }
    const checkpoint = record.pendingCheckpoint
    if (checkpoint && (checkpoint.rebaseAdoptionId !== record.id || checkpoint.rebasedFrom !== record.from ||
      ![checkpoint.commitOid, checkpoint.treeOid].every((oid) => typeof oid === "string" && /^[a-f0-9]{40,64}$/.test(oid)) ||
      (checkpoint.parentOid !== null && (typeof checkpoint.parentOid !== "string" || !/^[a-f0-9]{40,64}$/.test(checkpoint.parentOid))) ||
      !Number.isSafeInteger(checkpoint.sessionSeq) || checkpoint.sessionSeq < record.basisSequence ||
      typeof checkpoint.barrierId !== "string" || typeof checkpoint.logicalTreeHash !== "string")) throw new Error("Invalid retained rebase checkpoint")
    const pending = record.pendingResolution
    if (pending && (typeof pending.rebaseHead !== "string" || !/^[a-f0-9]{40,64}$/.test(pending.rebaseHead) ||
      typeof pending.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(pending.fingerprint) || !Array.isArray(pending.choices) ||
      pending.choices.length === 0 || new Set(pending.choices.map((choice) => choice.path)).size !== pending.choices.length ||
      pending.choices.some((choice) => !record.variants.some((variant) => variant.path === choice.path) ||
        (choice.oid === null ? choice.mode !== "0" : typeof choice.oid !== "string" || !/^[a-f0-9]{40,64}$/.test(choice.oid) ||
          !["100644", "100755", "120000", "160000"].includes(choice.mode))))) {
      throw new Error("Invalid retained rebase resolution")
    }
    return new RebaseJournal(directory, record)
  }

  static async create(commonGitDirectory: string, sessionId: string, from: string, onto: string, basisSequence: number): Promise<RebaseJournal> {
    if (![from, onto].every((oid) => /^[a-f0-9]{40,64}$/.test(oid))) throw new Error("Invalid rebase basis")
    if (!Number.isSafeInteger(basisSequence) || basisSequence < 0) throw new Error("Invalid rebase basis sequence")
    const parent = path.join(commonGitDirectory, "cozea", "rebases", createHash("sha256").update(sessionId).digest("hex"))
    await fs.mkdir(parent, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    const directory = path.join(parent, id)
    await fs.mkdir(directory, { mode: 0o700 })
    const journal = new RebaseJournal(directory, { version: 1, id, sessionId, from, onto,
      basisSequence, state: "prepared", createdAt: Date.now(), variants: [] })
    await journal.write()
    return journal
  }

  static async list(common: string, sessionId: string): Promise<RebaseJournalRecord[]> {
    const parent = path.join(common, "cozea", "rebases", createHash("sha256").update(sessionId).digest("hex"))
    const entries = await fs.readdir(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    const records: RebaseJournalRecord[] = []
    for (const id of entries) {
      const journal = await RebaseJournal.open(common, sessionId, id)
      if (!["applied", "canceled"].includes(journal.record.state)) records.push(journal.record)
    }
    return records.sort((a, b) => b.createdAt - a.createdAt)
  }

  async beginAdoption(): Promise<void> {
    if (!this.record.resultOid || !["computed", "adopting", "adopted"].includes(this.record.state)) throw new Error("No computed rebase is available for adoption")
    this.record.state = "adopting"
    await this.write()
  }

  async markAdopted(): Promise<void> {
    this.record.state = "adopted"
    await this.write()
  }

  async retainCheckpoint(checkpoint: RoomCheckpointInput): Promise<void> {
    if (this.record.state !== "adopted" || checkpoint.rebaseAdoptionId !== this.record.id || checkpoint.rebasedFrom !== this.record.from) throw new Error("Checkpoint does not match adopted rebase")
    this.record.pendingCheckpoint = checkpoint
    await this.write()
  }

  async finish(state: "applied" | "canceled"): Promise<void> {
    this.record.state = state
    await this.write()
  }

  async captureConflicts(index: string): Promise<void> {
    const variants: RebaseIndexVariant[] = []
    for (const entry of index.split("\0").filter(Boolean)) {
      const match = /^(\d{6}) ([a-f0-9]{40,64}) ([123])\t([\s\S]+)$/.exec(entry)
      if (!match) throw new Error("Invalid isolated rebase index")
      variants.push({ mode: match[1], oid: match[2], stage: Number(match[3]) as 1 | 2 | 3, path: match[4] })
    }
    if (variants.length === 0) throw new Error("Isolated rebase has no conflict variants")
    this.record.variants = variants
    this.record.state = "conflicted"
    await this.write()
  }

  async computed(resultOid: string): Promise<void> {
    if (!/^[a-f0-9]{40,64}$/.test(resultOid)) throw new Error("Invalid rebased result")
    this.record.resultOid = resultOid
    this.record.state = "computed"
    delete this.record.pendingResolution
    await this.write()
  }

  async retainResolution(resolution: NonNullable<RebaseJournalRecord["pendingResolution"]>): Promise<void> {
    this.record.pendingResolution = resolution
    await this.write()
  }

  async finishResolutionStep(): Promise<void> {
    delete this.record.pendingResolution
    await this.write()
  }

  private async write(): Promise<void> {
    const temporary = path.join(this.directory, `record-${randomUUID()}.tmp`)
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(JSON.stringify(this.record))
      await handle.sync()
    } finally { await handle.close() }
    await fs.rename(temporary, path.join(this.directory, "record.json"))
    const directory = await fs.open(this.directory, "r")
    try { await directory.sync() } finally { await directory.close() }
  }
}
