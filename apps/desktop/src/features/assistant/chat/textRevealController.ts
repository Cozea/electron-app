import {
  currentTextArrivalRevision,
  getMessageTextArrival,
  type MessageTextArrival,
} from "../model/messageTextArrival";
import type { ChatMessage } from "../model/types";

export const TEXT_REVEAL_MAX_DELAY_MS = 250;
const TARGET_DELAY_MS = 120;
const GRAPHEMES_PER_SECOND = 160;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface TextRevealSnapshot {
  displayText: string;
  isRevealing: boolean;
}

export interface TextRevealScheduler {
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

interface RevealEntry {
  target: string;
  streaming: boolean;
  boundaries: number[];
  shown: number;
  credit: number;
  lastFrameAt: number;
  arrival?: MessageTextArrival;
  snapshotRevision: number;
  entrancePending: boolean;
  snapshot: TextRevealSnapshot;
}

const EMPTY_SNAPSHOT: TextRevealSnapshot = { displayText: "", isRevealing: false };

/** One registry per mounted thread timeline; only message subscribers receive frames. */
export class TextRevealController {
  private readonly entries = new Map<string, RevealEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pending = new Set<string>();
  private readonly baselineRevision = currentTextArrivalRevision();
  private frame: number | null = null;
  private enabled = true;
  private readonly scheduler: TextRevealScheduler;

  constructor(scheduler: TextRevealScheduler, messages: readonly ChatMessage[] = []) {
    this.scheduler = scheduler;
    for (const message of messages) {
      if (message.role === "assistant") this.seed(message);
    }
  }

  getSnapshot = (id: string): TextRevealSnapshot =>
    this.entries.get(id)?.snapshot ?? EMPTY_SNAPSHOT;

  subscribe = (id: string, listener: () => void): (() => void) => {
    const listeners = this.listeners.get(id) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(id);
    };
  };

  /** Called once on first visible text, not on every recycled row mount. */
  consumeEntrance(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry?.entrancePending || !entry.snapshot.displayText || !this.enabled) return false;
    entry.entrancePending = false;
    return true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      for (const [id, entry] of this.entries) {
        entry.entrancePending = false;
        this.finish(id, entry);
      }
    } else {
      this.schedule();
    }
  }

  sync(messages: readonly ChatMessage[], immediate = false): void {
    const ids = new Set<string>();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      ids.add(message.id);
      this.update(message, immediate);
    }
    for (const id of this.entries.keys()) {
      if (!ids.has(id)) {
        this.entries.delete(id);
        this.pending.delete(id);
      }
    }
    if (this.pending.size === 0) this.stop();
    else this.schedule();
  }

  /** StrictMode can reconnect the same registry; sync resumes pending work. */
  stop(): void {
    if (this.frame !== null) this.scheduler.cancelFrame(this.frame);
    this.frame = null;
  }

  private seed(message: ChatMessage): RevealEntry {
    const arrival = getMessageTextArrival(message);
    const entry: RevealEntry = {
      target: message.text,
      streaming: message.streaming,
      boundaries: [],
      shown: message.text.length,
      credit: 0,
      lastFrameAt: this.scheduler.now(),
      arrival,
      snapshotRevision: arrival?.snapshot?.revision ?? 0,
      entrancePending: false,
      snapshot: { displayText: message.text, isRevealing: false },
    };
    this.entries.set(message.id, entry);
    return entry;
  }

  private update(message: ChatMessage, immediate: boolean): void {
    const arrival = getMessageTextArrival(message);
    let entry = this.entries.get(message.id);
    const live = arrival?.source === "live" && arrival.revision > this.baselineRevision;
    if (!entry) {
      entry = this.seed(message);
      entry.snapshot = EMPTY_SNAPSHOT;
      if (live && this.enabled && !immediate) {
        entry.target = arrival.snapshot?.text ?? "";
        entry.shown = entry.target.length;
        entry.entrancePending = entry.target.length === 0;
        entry.arrival = undefined;
      }
    }

    const snapshotChanged =
      arrival?.snapshot !== undefined && arrival.snapshot.revision !== entry.snapshotRevision;
    if (snapshotChanged) {
      entry.target = arrival.snapshot!.text;
      entry.shown = entry.target.length;
      entry.boundaries = [];
      entry.snapshotRevision = arrival.snapshot!.revision;
      entry.entrancePending = false;
    }
    const changed = entry.target !== message.text;
    entry.streaming = message.streaming;
    const replacement = changed && !message.text.startsWith(entry.target);
    const canReveal = this.enabled && !immediate && live && !replacement;

    if (!canReveal) {
      entry.target = message.text;
      entry.arrival = arrival;
      entry.entrancePending = false;
      this.finish(message.id, entry);
      return;
    }

    if (changed) {
      // Re-segment the unrevealed suffix plus the preceding grapheme. This
      // handles a combining mark/ZWJ split across chunks without rescanning history.
      const start = entry.boundaries.findLast((end) => end < entry.shown) ?? 0;
      entry.target = message.text;
      const boundaries: number[] = [];
      for (const part of segmenter.segment(message.text.slice(start))) {
        const end = start + part.index + part.segment.length;
        if (end > entry.shown) boundaries.push(end);
      }
      entry.boundaries = boundaries;
      if (!this.pending.has(message.id)) {
        entry.lastFrameAt = this.scheduler.now();
        entry.credit = 0;
      }
    }
    entry.arrival = arrival;
    if (entry.shown < entry.target.length) {
      this.pending.add(message.id);
      this.advance(message.id, entry, this.scheduler.now());
    } else {
      this.publish(message.id, entry);
    }
  }

  private advance(id: string, entry: RevealEntry, now: number): void {
    const elapsed = Math.max(0, now - entry.lastFrameAt);
    entry.lastFrameAt = now;
    // A JSON chunk can end between UTF-16 surrogate halves. Wait for its other
    // half without keeping a frame loop alive while the provider is paused.
    const safeEnd =
      entry.streaming && /[\uD800-\uDBFF]$/.test(entry.target)
        ? entry.target.length - 1
        : entry.target.length;
    const boundaries = entry.boundaries.filter((end) => end > entry.shown && end <= safeEnd);
    const rate = Math.max(GRAPHEMES_PER_SECOND / 1_000, boundaries.length / TARGET_DELAY_MS);
    entry.credit += elapsed * rate;
    const count = Math.min(boundaries.length, Math.floor(entry.credit));
    entry.credit -= count;
    let next = count > 0 ? boundaries[count - 1]! : entry.shown;
    // A provider burst can be coalesced before React commits. Honor its original
    // receipt time, not just the time this controller first sees it.
    for (const batch of entry.arrival?.batches ?? []) {
      if (now - batch.receivedAt >= TEXT_REVEAL_MAX_DELAY_MS)
        next = Math.max(next, Math.min(batch.end, safeEnd));
    }
    // Round overdue offsets up to a whole grapheme.
    if (next > entry.shown) {
      entry.shown = boundaries.find((end) => end >= next) ?? safeEnd;
    }
    if (entry.shown >= entry.target.length) this.finish(id, entry);
    else {
      if (entry.shown >= safeEnd) this.pending.delete(id);
      this.publish(id, entry);
    }
  }

  private finish(id: string, entry: RevealEntry): void {
    entry.shown = entry.target.length;
    entry.boundaries = entry.boundaries.slice(-2);
    entry.credit = 0;
    this.pending.delete(id);
    this.publish(id, entry);
  }

  private publish(id: string, entry: RevealEntry): void {
    const displayText = entry.target.slice(0, entry.shown);
    const isRevealing = entry.shown < entry.target.length;
    if (entry.snapshot.displayText === displayText && entry.snapshot.isRevealing === isRevealing)
      return;
    entry.snapshot = { displayText, isRevealing };
    this.listeners.get(id)?.forEach((listener) => listener());
  }

  private schedule(): void {
    if (!this.enabled || this.frame !== null || this.pending.size === 0) return;
    this.frame = this.scheduler.requestFrame(() => {
      this.frame = null;
      const now = this.scheduler.now();
      for (const id of this.pending) {
        const entry = this.entries.get(id);
        if (entry) this.advance(id, entry, now);
      }
      this.schedule();
    });
  }
}
