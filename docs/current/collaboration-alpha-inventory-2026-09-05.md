# Collaboration alpha inventory, 2026-09-05

This read-only inventory was performed against the configured production Convex
deployment `knowing-finch-546`, the pinned `cozea-collab` Worker account, and the
two existing local Cozea profiles. No reset, deployment, credential change or
webhook activation was performed. Repeat the inventory immediately before rollout.

## Convex

Production reads used the installed Convex CLI with explicit `--prod`, a limit of
129 rows per table and captured output reduced to counts/scope metadata. Secrets,
wrapped key contents, source text and device identities were omitted from output.
The main checkout's existing deployment selection was passed in process memory;
no development deployment was configured or run.

| Scope | Rows | Action |
| --- | ---: | --- |
| collaborationSessions | 0 | No reset targets |
| collaborationParticipants | 0 | No reset targets |
| collaborationSessionEvents | 0 | No reset targets |
| collaborationPublications | 0 | No reset targets |
| collaborationRepositoryResolutions | 0 | No reset targets |
| collaborationRepositoryBindings | 0 | No reset targets |
| collaborationRepositoryAccessEvents | 0 | No reset targets |
| collaborationVerifiedRepositories | 0 | No reset targets |
| collaborationRepositorySetups | 0 | No reset targets |
| collaborationInstallationRevocations | 0 | No reset targets |
| projectCollabRoomKeys | 2 | Retain: both belong to ordinary project rooms |
| projectCollabWrappedKeys | 2 | Retain: both belong to ordinary project rooms |
| projectCollabKeyRequests | 0 | No reset targets |
| projectCollabRecoveryKits | 0 | No reset targets |

Every listed table fit in the bounded read. Empty CLI results were verified
against its explicit no-documents response, not inferred from a JSON parse failure.
No `session:` key-room associations were present. Existing project Yjs state,
identities, devices, projects, chats and ordinary synchronization are retained.

## Cloudflare

The `COLLAB_ROOM` namespace `b018e66f783a49799f18d94f48466057` contains 22
listed object identities, all reporting `hasStoredData: false`. Pagination used
a 128-object limit, then the returned cursor; the terminal page contained zero
objects and an empty cursor. No stored room data was identified for reset.
Other Worker namespaces and R2 buckets were not reset targets.

The active deployment is `d10a4251-8021-43f0-9aac-6f52067f1fc9`, serving version
`bd88432f-4c82-4ffb-a230-658333bd9191` at 100%, created September 4 at 23:45 UTC.
The GitHub App ID, key, OAuth client ID/secret and callback secret bindings are
present by name. The GitHub webhook secret is absent. These observations do not
establish successful OAuth, webhook delivery or deployed generation-3 support.

## Local profiles

Both `cozea` and `@cozea/desktop` under the existing Application Support directory
were checked. Their workspace catalogs were opened read-only and queried only
for collaboration settings; both contained zero matching records. Each profile's
dedicated `collaboration` subtree contained zero entries/bytes. Inventory was
bounded to 10,000 entries and depth 10 and did not follow symlinks.

Ordinary workspace folders, Git directories, chats, identities, renderer project
sync caches and unrelated app data are outside the deletion inventory.

## Cutover decision

The current deletion inventory is empty. The alpha reset is therefore a no-op for
this observed environment. Do not add broad deletion code or delete ordinary room
keys to manufacture a nonempty reset. If a later inventory finds data, classify it
by exact session ownership/generation and preserve unpublished recovery before
proposing any mutation. Generation-3 protocol and creation fences remain required
to prevent stale clients from recreating obsolete sessions. Both release gates
remain disabled pending implementation and packaged acceptance.
