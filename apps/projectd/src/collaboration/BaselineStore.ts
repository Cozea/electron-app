/**
 * Materialization baseline store for snapshot-anchored ingress.
 *
 * Master Specification: Section 10.11
 * Stores exact materialized text B, its Yjs state vector, and snapshot update.
 */

import { createHash } from "node:crypto"

export interface TextBaseline {
  readonly fileId: string
  readonly text: string
  readonly contentHash: string
  readonly stateVector: Uint8Array
  readonly snapshotUpdate: Uint8Array
  readonly updatedAt: number
}

export class BaselineStore {
  private readonly baselines = new Map<string, TextBaseline>()

  setBaseline(params: {
    fileId: string
    text: string
    stateVector: Uint8Array
    snapshotUpdate: Uint8Array
    contentHash?: string
  }): TextBaseline {
    const contentHash =
      params.contentHash ?? createHash("sha256").update(params.text).digest("hex")

    const baseline: TextBaseline = {
      fileId: params.fileId,
      text: params.text,
      contentHash,
      stateVector: params.stateVector,
      snapshotUpdate: params.snapshotUpdate,
      updatedAt: Date.now(),
    }

    this.baselines.set(params.fileId, baseline)
    return baseline
  }

  getBaseline(fileId: string): TextBaseline | null {
    return this.baselines.get(fileId) ?? null
  }

  hasBaseline(fileId: string): boolean {
    return this.baselines.has(fileId)
  }

  deleteBaseline(fileId: string): boolean {
    return this.baselines.delete(fileId)
  }

  clear(): void {
    this.baselines.clear()
  }
}
