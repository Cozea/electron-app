# Collaboration v2 review hardening

Scope: PR #141, reviewed from `6c2437090733488322506fa5973770a022a343cd`.

- Token rotation updates the live transport without bootstrapping the room again.
- Renderer gateway URLs and GitHub API URLs are validated before sending credentials;
  token-bearing requests reject redirects and token responses use `Cache-Control: no-store`.
- Repository downloads reject a binding/credential race before creating a workspace.
- GitHub numeric IDs must be positive safe integers. Expired/revoked principals cannot
  obtain write credentials. Leaving during push preserves pending publication metadata.
- A socket is bound to the room selected at upgrade; media uses a server-assigned peer
  identity rather than a caller-selected Yjs client ID. Connecting sockets close on teardown.
- Command text, paths and terminal attribution use an optional independently encrypted
  metadata field, authenticated to the original update's AAD. The main ciphertext remains
  raw Yjs bytes, so existing encrypted updates remain readable.
- Room update failures do not poison subsequent operations. New updates have a 96 KiB
  encoded-payload limit (below the Durable Object KV value limit), 128 KiB frame limit,
  per-user 10-second rate budget (600 updates / 8 MiB), and retained session budget
  (25,000 updates / 64 MiB). Existing records count toward these budgets. Rejected updates
  are not acknowledged or silently deleted from the local outbox. Larger-update chunking
  is not implemented in this hardening patch.
- Individual rejected file reads are reported in the seeding failure count.

Validation: see the GitHub Actions run associated with the final PR head. Passing CI is
not evidence of a deployed two-machine GUI test or completion of every design-plan phase.
