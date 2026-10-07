# Local desktop identity and optional cloud service

Implemented checkpoint: 2026-10-02 (Asia/Singapore). The shell no longer requires cloud configuration or device enrollment. Local project discovery/create/import/preferences now use the durable catalog; the remaining project-system cutover is recorded in the [implementation ledger](current/project-system-implementation.md).

## Device readiness

`desktopBootstrap:getLocalDevice` resolves the actual installation identity through Electron's existing signing/encryption key service. The renderer receives public presentation only: `identityKey`, platform, name, avatar, configuration state and update time. It receives no fabricated `principalId`.

`desktop-local-device.v1.json` lives under Electron `userData`, uses atomic serialized writes and mode `0600`, and contains no credentials or key material. Names are bounded to 80 characters; avatars are bounded raster data URLs or HTTPS URLs retained from historical presentation. Credential-bearing URLs, control characters, extra persisted fields and invalid identities are rejected. A malformed file falls back to fresh local presentation, without replacing cryptographic identity.

An older encrypted bootstrap session may seed presentation only after its public identity matches the actual installation key. It cannot authorize cloud access. A changed physical identity receives a fresh presentation state; stale local update requests are rejected. The existing navigation locator and encrypted session formats remain unchanged; the version-2 bootstrap snapshot gains optional `localDevice` data.

`AuthContext.localDevice` and `isLocalDeviceReady` control shell entry, onboarding and ordinary navigation. `user`, `principalId` and `accessToken` remain separate cloud state. `isAuthenticated` retains its historical cached-cloud-presentation meaning and must not gate local work or authorize cloud calls. Cloud readiness remains `isConvexAuthReady` plus verified server authorization.

First-run setup saves a required name and optional optimized avatar locally. GitHub connection remains in Settings. Device settings also save presentation locally; synchronizing this presentation to shared principal metadata is pending the explicit cloud-association phase. The account screen says that presentation is stored on this device. Reset with retained cloud enrollment presentation authenticates and self-revokes before local key deletion; without that state it deletes local keys. Lost/corrupt enrollment-cache recovery still needs native qualification.

Fresh devices do not authenticate merely to mount the shell. A matching previously enrolled bootstrap session may revalidate in the background after local readiness. Its failure leaves local identity intact. Explicit connection prompts in device, organization and GitHub settings, the organization Store and project join flow invoke cloud authentication. Missing cloud configuration is explained without substituting a dummy client. A rejected cloud profile clears live cloud authority without throwing out the local shell. Authentication responses must match the installation identity and principal relationship before secure persistence.

## Optional query boundary

Renderer cloud hooks import from `@/lib/cloudQueries`. The app-owned context contains a genuine configured `ConvexReactClient`, a retained-query facade over that client, or `null`. The SDK provider is mounted only with a genuine client; ordinary children always render. No SDK query/mutation hooks mount without that provider.

- `useConvex` returns the nullable actual client. Imperative cloud actions call `requireCloudClient`; local prefetch continues independently when no client exists.
- Queries have stable external-store snapshots, use inert SDK watches until subscription, close the read/subscribe race and unsubscribe on effect cleanup. Query identity uses function name and serialized Convex arguments, avoiding churn from generated references.
- Absent service configuration returns undefined query values and creates no watches or sockets. Cloud feature views must show availability explicitly rather than treating this as an endless loading state. The connection prompt supplies this affordance at the current entry points; remaining project feature controls are being cut over with the local route model.
- Query errors remain errors. `useQuery` throws for views that require their data; `useQueries` returns error values. Decorative/local-shell reads use `useSafeConvexQuery` so rejected cloud state cannot replace the local experience.
- Mutation/action handles mount safely without a client and reject with `CloudUnavailableError` only when invoked. Configured handles delegate to SDK operations, including mutation optimistic updates.
- Retained pages provide the same genuine facade to both contexts. Hidden subscriptions stay held and fresh results are read on reveal; eviction still releases them.

Local IDs never become Convex IDs at this boundary. Project routes/workspace runtime, sidebar discovery, Search, creation/import and local settings use a [separate local read model](local-project-routing.md). A configured client or cached presentation does not enroll a personal project. Distinct local/cloud session execution remains gated until its daemon mapping is completed.

## Checkpoint evidence

Tests use isolated stores and simulated subscription transports. Optional-hook server rendering exercises absent configuration and genuine SDK watch creation with a WebSocket tripwire; it also covers error snapshot stability, subscribe cleanup, retained reveal and delegated optimistic mutation behavior. Store tests cover offline presentation/restart, checked legacy presentation migration, replacement identity, bounded input, corruption/extra-field recovery and concurrent writes.

These fixtures alone do not establish a complete offline Electron journey, signed upgrade or two-device collaboration. Temporary-profile Electron runs exercised local onboarding, personal project creation, rename/hide/reveal/reload and repeated non-Git folder import with renderer remote requests blocked. Final checks confirmed null cloud associations, stable workspace ownership, unchanged attached source files, correct local assistant roots and reused initial assistant tiles across reload/reopening. The ledger records those checks and their limits; main-process/provider network traffic was not fully measured, and no provider turn was sent. Native OS folder picking, complete cold-start/network-revocation cases and physical-device acceptance remain. The [completion plan](current/project-system-completion-plan.md) retains the full goal and authenticated shared mapping.
