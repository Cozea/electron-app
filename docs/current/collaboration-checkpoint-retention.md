# Supervised checkpoint retention, 2026-09-05

The room performs one bounded history-cleanup pass during authenticated checkpoint
inspection or finalization. Fresh Convex authority must confirm that the durable
replacement checkpoint uses the active key and no rotation is pending. Cleanup
verifies replacement identity, every encrypted chunk, checksum and sequence before
removing an older covered checkpoint. Local keys, offline records, file initializer
receipts and unpublished room updates remain outside this cleanup.

Each pass removes at most 128 records from one old checkpoint. The old descriptor
remains a durable cursor until its final pieces are deleted atomically with it.
Lost replies and failed deletes retry without requiring an in-memory cursor.
Invalid evidence retains the remaining history and emits only the content-free
`checkpoint_retention_deferred` diagnostic.

Published update compaction also splits deletes into batches of at most 128 keys
inside its existing transaction. Previously, a page of chunked updates could exceed
Cloudflare's API limit and fail publication cleanup. The storage test double now
enforces that limit. Publication deduplication receipts remain retained for offline
retries. Active sessions bound deduplication receipts to 100,000 operations and
visibly pause admission at that limit. Closed rooms delete only idempotency, rate
and file-initialization metadata, at most 128 records per alarm pass. The next
alarm is set before deletion, making failed batches retryable. The permanent
closure marker fences even previously authenticated sockets with stale positive
authority responses. Checkpoints, receive updates, unfinished uploads and unknown
data remain retained. Local sealed-key retirement remains a separate policy.

Checkpoint replacement and abandoned-upload lease replacement now atomically save
an exact cleanup descriptor with the new pointer. The same bounded collector
consumes these descriptors after authenticating the active replacement. A crash
after checkpoint publication, or before deleting its upload lease, neither strands
covered pieces nor makes clients wait for a finalized lease to expire. Unknown
pieces without a recorded ownership transition remain retained. The observed
alpha inventory contained no stored room data requiring a historical sweep.

Validation: 36 checkpoint-recovery, history-retention and isolated-room tests passed;
Worker typecheck and focused lint passed. Tests include an older Yjs edit applied
after history cleanup, activation and authorization boundaries, corruption,
interrupted deletion, bounded retry, and preserving newer unpublished updates.
These are local behavioral checks, not deployed or packaged acceptance.
