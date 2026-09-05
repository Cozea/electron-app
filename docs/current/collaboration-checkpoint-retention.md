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
retries; this change does not claim to implement their final retention policy, local
sealed-key retirement, orphan-piece collection or the cross-service alpha reset.

Validation: 33 checkpoint-recovery, history-retention and isolated-room tests passed;
Worker typecheck and focused lint passed. Tests include an older Yjs edit applied
after history cleanup, activation and authorization boundaries, corruption,
interrupted deletion, bounded retry, and preserving newer unpublished updates.
These are local behavioral checks, not deployed or packaged acceptance.
