# Local key and initialization history retention

Sealed device-key writes share the application's recovery storage admission budget.
Peak atomic replacement space includes old/current/version copies and interrupted
files. Sealed records are limited to 64 KiB and 64 versions per session. Exhaustion
pauses new key caching without evicting recoverable versions. Independent handles
serialize saves; stale authority cannot move the current offline key backwards.
Pending rotation keys are retained separately until activation.

Explicit cleanup is serialized with Start. Active runtimes and failed owners permit
only authenticated checkpoint-covered receive-log cleanup. After all session owners
stop, initialization bases may be retired if every retained key version has no
outbox, renderer ingress or offline recovery entries and an authenticated durable
current checkpoint contains the complete basis. Applying the basis must leave the
checkpoint's encoded Yjs state unchanged, including delete sets and pending structs.
State vectors alone are insufficient proof. Every selected encrypted base is
validated before deletion and exact stored bytes are rechecked at removal.

The project control lists catalog-owned retained sessions using both their workspace
policy and canonical session association. Left sessions expose Resume; ended sessions
expose their retained local folder and cleanup without rejoining a closed room.
Ordinary/unrelated workspaces are excluded and mismatched associations fail visibly.

Older sealed keys may be retired only when the corresponding epoch has literally
no remaining records, no cross-epoch journal entries or pending sends exist, and
no projection receipts remain. Current and pending rotation keys cannot be selected.
All checkpoints, uploads, projection receipts/backups, unknown files and unresolved
histories retain their keys. This conservative policy deliberately keeps keys when
dependency absence cannot be established. A Git commit never replaces CRDT history.

Teardown now drains maintenance and publication before removing a session owner.
Quit also drains already-admitted cleanup. This prevents a late rotation/checkpoint
writer from creating a dependency after its key inventory was checked.

Validation uses temporary filesystem stores, authenticated AES envelopes, actual Yjs
histories and the production Host with controlled runtime/gateway boundaries. Tests
cover older-key bases, missing deletes/inserts, pending outbox/ingress, unresolved
journals, tampering, unknown records, storage exhaustion, stale/concurrent key saves,
safe key retirement, Start/cleanup exclusion, failed owners and quit draining.
Three additional behavioral checks cover retained-workspace discovery, forged/stale
associations and bounded failure handling.
These checks do not establish packaged OS keychain or multi-device GUI acceptance.
