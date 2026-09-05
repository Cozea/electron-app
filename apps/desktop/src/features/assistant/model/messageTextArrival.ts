import type { ChatMessage } from "./types";

/** Renderer-only provenance. Weak keys keep this out of persistence and wire contracts. */
export interface MessageTextArrival {
  revision: number;
  receivedAt: number;
  source: "snapshot" | "live";
  snapshot?: { revision: number; text: string };
  batches?: readonly { end: number; receivedAt: number }[];
}

const arrivals = new WeakMap<ChatMessage, MessageTextArrival>();
let revision = 0;

export function currentTextArrivalRevision(): number {
  return revision;
}

export function getMessageTextArrival(message: ChatMessage): MessageTextArrival | undefined {
  return arrivals.get(message);
}

export function markSnapshotText(messages: readonly ChatMessage[]): void {
  const nextRevision = ++revision;
  const receivedAt = performance.now();
  for (const message of messages) {
    arrivals.set(message, {
      revision: nextRevision,
      receivedAt,
      source: "snapshot",
      snapshot: { revision: nextRevision, text: message.text },
    });
  }
}

export function markLiveText(message: ChatMessage, previous?: ChatMessage): void {
  const receivedAt = performance.now();
  const previousArrival = previous ? arrivals.get(previous) : undefined;
  const appending = previous !== undefined && message.text.startsWith(previous.text);
  const previousBatches = appending ? (previousArrival?.batches ?? []) : [];
  // Retain recent arrival boundaries even if React batches several provider events.
  // Older boundaries can be folded together: all are already due for display.
  const expired = previousBatches.filter((batch) => receivedAt - batch.receivedAt >= 250);
  const batches = [
    ...expired.slice(-1),
    ...previousBatches.filter((batch) => receivedAt - batch.receivedAt < 250),
  ];
  if (!appending || message.text.length > previous.text.length) {
    batches.push({ end: message.text.length, receivedAt });
  }
  arrivals.set(message, {
    revision: ++revision,
    receivedAt,
    source: "live",
    snapshot: previousArrival?.snapshot,
    batches,
  });
}
