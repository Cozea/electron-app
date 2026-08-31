# Org DevApps

> **T3 surface cutover (2026-08-31):** Ready static and service releases render through the shared
> renderer-wide T3 `<webview>` host. Artifact verification, trust approval, encrypted environment
> configuration, runtime leases, logs, and stop/restart remain independent. Protected
> custom-scheme and authenticated loopback origins stay inside the publication session and are
> never offered to the external-browser action.

Org DevApps publish an immutable **static** or **service** artifact to a Cozea-owned organization.
Every org member can open every published DevApp in that org. Consumers never receive the source
project, a local path, a development command, or a dependency-install recipe.

`VITE_FF_PROJECT_DEVAPPS` defaults to `true` and hides publish / Store / launcher / settings DevApp UI when set to `false`.

## Product rules

- Identity is a Cozea device group. Admins add initialized device principals by their public
  `czd_…` ID; the group's copyable public ID uses `czg_…`.
- Left-nav **Publish** / **Update** only builds, packs, and uploads. It does not start a preview, navigate into Dev Server, or call `startDevServerRun`.
- Open path is an isolated in-Cozea tile (`addTile` + `orgDevApp`), never the Dev Server singleton.
  Static releases use `cozea-devapp://`; service releases use an authenticated release-scoped
  loopback gateway and never expose their raw process port.
- Consumer payloads contain publication metadata + artifact identity only. They must not include `projectId`, `localPath`, git URL, `workspaceId`, `devCommand`, or `devPort`.
- Store cards are labeled with the **organization name**. Do not describe this catalog as This Mac / Local DevApps.

## Organizations

Convex tables:

- `organizations` — public group ID, name, creator, timestamps
- `organizationMembers` — `admin` | `member`
- `projects.organizationId` — required before a project can publish

Settings → **Organizations** lists every group the authenticated device belongs to, its device
members, its public group ID, and every DevApp published there. Group admins add devices by public
device ID, remove members, and can archive a DevApp.

Every authenticated Convex function that lists or mutates an org checks membership with `requireOrgMember` / `requireOrgAdmin`. Do not trust a client-supplied “list this org” without that check.

## Publish lifecycle

1. The project overflow menu shows **Publish** when the project has no active artifact release.
2. If the project is not attached to an org, Cozea prompts to create one or attach an existing org you belong to.
3. First publish always asks for a PNG, JPEG, or WebP logo. Later **Update** reuses the publication logo unless it is missing.
4. Electron main detects a **build** script (not `dev`) and runs it without a shell. A static
   `index.html` remains the first output choice. Next.js `output: "standalone"`, Nuxt `.output`, or
   an explicit self-contained `cozeaDevApp.service` output produces a service release. Cozea never
   ships `npm run dev` to the organization.
5. Main packs the output as a zip, hashes it (SHA-256), and uploads those exact bytes directly to Convex `_storage`; the artifact does not cross renderer IPC. Convex verifies the stored digest before inserting an immutable `devAppReleases` row. The publication points at that release.
6. Name and logo live on the publication. Editing them in Project Settings or the identity dialog does not append a release.

The upload URL is issued together with a short-lived reservation bound to the authenticated device,
source project, and destination organization. Convex verifies the uploaded `_storage` size,
content type, and SHA-256 before the reservation can be consumed. Cozea normalizes both the
documented base16 metadata representation and the base64 digest returned by current hosted
deployments to canonical lowercase hex before comparing it with Electron's hash. Failed or
abandoned reservations delete their blob; a daily bounded cleanup removes expired reservations.
Each publication retains its newest ten releases and deletes older artifact blobs.

The publishing dialog reports build/package, upload, integrity verification, and release activation
as distinct stages. Cancel terminates an active build process group or aborts the upload and reclaims
the reservation. Errors remain retryable from the project menu.

If the project has no linked local folder, no `build` script, or no static `index.html` after build, publish stops without writing a release.

## Open lifecycle

1. Store **Your org** and the workbench launcher load `devApps.listMine` / `listForOrganization`.
2. Choosing an org DevApp resolves to `addTile` + `tileType: "orgDevApp"` (`publishedDevApp` launch kind).
3. The tile asks Convex for a short-lived artifact URL (`getArtifactUrl`), verifies the ZIP/hash,
   caches the immutable release under app data, prepares its publication-scoped browser session,
   and renders the static custom-scheme origin through the shared T3 host.
4. A service release validates platform, manifest, entrypoint, symlinks, and native-code exclusions;
   blocks on missing environment values; shows trusted-code approval bound to its content and
   permission hashes; then starts with Cozea's Electron executable in Node mode, a minimal
   environment, a publication-scoped data directory, and a 1 GiB V8 heap ceiling.
5. The main-process gateway continues to bind a secret header and exact content host to the leased
   runtime. Its authenticated loopback origin is rendered only inside the prepared publication
   session and is never exposed to the external-browser action.
6. `OrgDevAppArtifactService` registers the hardened custom protocol and authenticated gateway
   header once per persistent publication session. A release/content-hash change replaces the
   living guest generation, and main-process navigation policy confines it to that exact static or
   service release.
7. Several org apps, Browser, and Dev Server can be open at once. They do not share a run key.

Service releases run separately on each authorized Mac. Local files/databases are device-local;
shared data still requires an external HTTPS backend. Service code is trusted organization code in
the beta, not an OS-enforced sandbox.

Access is re-evaluated reactively while a tile is open. Archiving the publication or removing the
device from the organization stops access and prevents cached reopening. Guests use T3's approved
clipboard, notification, and geolocation permission allowlist; all other permissions and unmanaged
downloads are denied. Public HTTPS top-level links open externally, while custom-scheme,
authenticated loopback, cross-release, public HTTP, file, and other schemes never do.

## Artifact and cache limits

- static: 32 MiB compressed, 128 MiB expanded, 32 MiB/file, 4,096 entries
- service: 256 MiB compressed, 1 GiB expanded, 128 MiB/file, 50,000 entries
- UTF-8 path: 512 bytes maximum
- compression ratio: 200:1 maximum per file
- symbolic links, traversal, duplicate/case-colliding paths, invalid CRCs, truncated records, and
  unsupported compression methods are rejected
- local cache: 4 GiB, newest 48 releases, 30-day inactivity expiry, with atomic staging,
  coalesced preparation, and active-runtime eviction protection

The complete ZIP is still held as one bounded main-process upload buffer. Static and service limits
are deliberately separate; further increases require streaming pack/upload/download verification.
The renderer receives only the resulting storage ID and release metadata.

## Settings

The Organizations settings surface is the control plane for “which orgs we are part of”:

- list of orgs you belong to, with role
- device members and the copyable public group ID
- DevApps published in the selected org (name, version, Open, Archive for admins)

Every org member sees the same DevApp list. Opening from Settings uses the same isolated tile path as the launcher.

## Data model

- `devAppPublications`: org-scoped, `visibility: "organization"`, editable name/logo, active release pointer, `projectId` is publisher-only
- `devAppReleases`: append-only version, artifact identity, runtime kind, manifest/platform/arch,
  permission hash, publisher device identity, and framework. Legacy recipe fields remain unused.

The machine-local `localProjectDevAppStore` is compatibility-only for already-persisted development
tiles. It is not a consumer catalog. Store, launcher, settings, and the left-nav publish control must
not read it.

Project deletion owns both lifecycles: it removes the source project's machine-local publication
and releases immediately, then the bounded Convex project cascade removes any org publication,
release rows, and artifact blobs. Archiving a project does not delete either catalog.

## Convex deploy

Promote schema and functions with `bunx convex deploy`. **Never** use `convex dev` for this repository.
